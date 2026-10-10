import Foundation
import Observation
import SpjallCore

/// Whether this device is signed in, and the way there (decisions 0019 and
/// 0033): an invite link names who invited the person, each sign-in button
/// opens its provider in an ASWebAuthenticationSession, and the redirect comes
/// back to `signIn(provider:browser:)`. Signed in, `verify(browser:)` links
/// Kenni the same way, which puts the shield on the account; it is offered
/// once after a sign-in to an account without it. A link that joins this
/// device to the older account holding the kennitala starts the signed-in
/// session again (decision 0035).
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
    /// Counts finished Kenni links, so the verify screen closes and "Ég" reloads.
    private(set) var links = 0
    /// A sign-in just landed on an account without the mark: offer Kenni once.
    private(set) var offerVerify = false
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
    /// The provider of the last sign-in, which a retry opens again.
    private var provider = SignInProvider.google

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

    /// An invite link opened while signed in, for the list to open; nil once taken.
    private(set) var signedInInvite: String?

    /// An invite link was opened. Signed in, it waits in `signedInInvite` for the list.
    func openInvite(token: String) async {
        guard session != .signedIn else {
            signedInInvite = token
            return
        }
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

    /// Opens `provider` with `browser`, which returns the URL the provider
    /// redirected to, or nil when the person closed it.
    func signIn(provider: SignInProvider, browser: (URL) async throws -> URL?) async {
        self.provider = provider
        await open(browser: browser) { try $0.beginSignIn(provider: provider) }
    }

    /// Signed in: opens Kenni to link it to the account (decision 0033).
    func verify(browser: (URL) async throws -> URL?) async {
        await open(browser: browser) { try $0.beginLink(provider: .kenni) }
    }

    private func open(
        browser: (URL) async throws -> URL?,
        begin: @escaping @Sendable (Account) throws -> String
    ) async {
        guard !busy else { return }
        busy = true
        problem = nil
        let account = account
        do {
            let authorize = try await offMain { try begin(account) }
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

    /// Tries again what failed: the same callback when one is pending, else a
    /// new link when signed in, else a new sign-in with the same provider.
    func retry(browser: (URL) async throws -> URL?) async {
        if let pendingCallback {
            await complete(callback: pendingCallback)
        } else if session == .signedIn {
            await verify(browser: browser)
        } else {
            await signIn(provider: provider, browser: browser)
        }
    }

    /// The list has the invite link opened while signed in.
    func takeInvite() -> String? {
        defer { signedInInvite = nil }
        return signedInInvite
    }

    /// The account or this device is gone; start over.
    func signedOut() {
        inviteToken = nil
        signedInInvite = nil
        pendingCallback = nil
        invite = .none
        problem = nil
        busy = false
        session = .signedOut
    }

    /// Finishes the sign-in or, signed in, the link the callback belongs to.
    private func complete(callback: String) async {
        busy = true
        problem = nil
        let account = account
        let token = inviteToken
        let linking = session == .signedIn
        do {
            if linking {
                let moved = try await offMain { try account.completeLink(callback: callback) }
                pendingCallback = nil
                if moved {
                    // Joined to the older account: its conversations, from a fresh start.
                    didSignIn()
                } else {
                    busy = false
                    links += 1
                }
            } else {
                try await offMain { try account.completeSignIn(callback: callback, inviteToken: token) }
                inviteToken = nil
                pendingCallback = nil
                didSignIn()
                // Kenni is optional; the offer comes once, with "Seinna".
                if token == nil {
                    let verified = (try? await offMain { try account.me().verified }) ?? true
                    offerVerify = !verified
                }
            }
        } catch {
            // Unreachable keeps the sign-in or link pending in the core, so the
            // same callback can finish it; any other failure ended it.
            let problem = Problem(error)
            pendingCallback = problem == .unreachable ? callback : nil
            busy = false
            self.problem = problem
        }
    }

    /// The offer to verify was shown; it is not shown again until the next sign-in.
    func verifyOffered() {
        offerVerify = false
    }

    private func didSignIn() {
        offerVerify = false
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
