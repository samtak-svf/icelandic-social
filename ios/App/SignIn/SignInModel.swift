import Foundation
import Observation

/// Whether this device is signed in, and the way there (decision 0019): an
/// invite link names who invited the person, the sign-in button opens Kenni
/// in an ASWebAuthenticationSession, and Kenni's redirect comes back to
/// `signIn(browser:)`.
///
/// The invite token is kept in `defaults` until the sign-in it belongs to
/// ends: iOS may end the app while the person approves in their
/// authenticator, and the link should not have to be opened again. The
/// callback is not kept. The browser session runs inside the app, so a callback
/// can only outlive it when the server was unreachable, and that one is retried
/// from memory.
@MainActor @Observable
final class SignInModel {
    enum Session: Equatable { case checking, signedOut, signedIn }

    enum Invite: Equatable {
        /// No invite link was opened.
        case none
        case loading
        /// `name` is nil when the operator sent the link or the inviter has no name.
        case from(name: String?)
        case expired
    }

    private(set) var session = Session.checking
    private(set) var invite = Invite.none
    private(set) var busy = false
    private(set) var problem: Problem?
    /// Counts sign-ins, so each one gets a fresh "Ég" screen.
    private(set) var signIns = 0
    /// Topping up this device's KeyPackages after the last sign-in.
    @ObservationIgnored private(set) var stocking: Task<Void, Never>?

    /// The core, which the signed-in screens share.
    let account: Account
    private let defaults: UserDefaults
    private var inviteToken: String? {
        didSet { defaults.set(inviteToken, forKey: Self.inviteKey) }
    }
    /// A callback the server could not be reached to finish; `retry` sends it again.
    private var pendingCallback: String?

    private static let inviteKey = "signIn.invite"

    init(account: Account, defaults: UserDefaults = .standard) {
        self.account = account
        self.defaults = defaults
        inviteToken = defaults.string(forKey: Self.inviteKey)
    }

    /// Whether this device signed in before. Called once, at launch.
    func check() async {
        let account = account
        let signedIn = (try? await offMain { try account.signedIn() }) ?? false
        // A sign-in that finished meanwhile is not undone.
        guard session == .checking else { return }
        if signedIn {
            inviteToken = nil
            didSignIn()
        } else {
            session = .signedOut
            // A link opened before iOS ended the app.
            if let inviteToken, invite == .none { await openInvite(token: inviteToken) }
        }
    }

    /// An invite link was opened. Signed in, it has nothing to do yet.
    func openInvite(token: String) async {
        guard session != .signedIn else { return }
        inviteToken = token
        invite = .loading
        let account = account
        do {
            let inviter = try await offMain { try account.resolveInvite(token: token) }
            invite = .from(name: inviter?.name)
        } catch {
            // Only a 404 says the link is dead. Unreachable says nothing about
            // it, and signing in will try the token anyway.
            invite = error.isNotFound ? .expired : .from(name: nil)
        }
    }

    /// Opens Kenni with `browser`, which returns the URL Kenni redirected to,
    /// or nil when the person closed it.
    func signIn(browser: (URL) async throws -> URL?) async {
        guard !busy else { return }
        busy = true
        problem = nil
        let account = account
        do {
            let authorize = try await offMain { try account.beginSignIn() }
            guard let url = URL(string: authorize), let callback = try await browser(url) else {
                busy = false
                return
            }
            busy = false
            await complete(callback: callback.absoluteString)
        } catch {
            busy = false
            problem = Problem(error)
        }
    }

    /// Tries again what failed: the same callback when one is pending, else a new sign-in.
    func retry(browser: (URL) async throws -> URL?) async {
        if let pendingCallback {
            await complete(callback: pendingCallback)
        } else {
            await signIn(browser: browser)
        }
    }

    /// The account or this device is gone; start over.
    func signedOut() {
        inviteToken = nil
        pendingCallback = nil
        invite = .none
        problem = nil
        busy = false
        session = .signedOut
    }

    private func complete(callback: String) async {
        busy = true
        problem = nil
        let account = account
        let token = inviteToken
        do {
            try await offMain { try account.completeSignIn(callback: callback, inviteToken: token) }
            inviteToken = nil
            pendingCallback = nil
            didSignIn()
        } catch {
            // Unreachable keeps the sign-in pending in the core, so the same
            // callback can finish it; any other failure ended it.
            let problem = Problem(error)
            pendingCallback = problem == .unreachable ? callback : nil
            busy = false
            self.problem = problem
        }
    }

    private func didSignIn() {
        invite = .none
        problem = nil
        busy = false
        signIns += 1
        session = .signedIn
        let account = account
        // Best effort: the last-resort KeyPackage covers a failure, and the
        // next launch tries again.
        stocking = Task.detached(priority: .utility) { try? account.stockKeyPackages() }
    }
}
