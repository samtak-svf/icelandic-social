import Foundation
import Observation
import SpjallCore

/// "Ég" (decisions 0009, 0019): who the person is, their invite link, their
/// devices, and deleting the account.
///
/// The link is made only when the person asks for one. Making one ends the
/// link before it, so doing it on its own would silently kill a link another
/// device of the account has already shared.
@MainActor @Observable
final class MeModel {
    private(set) var me: Me?
    private(set) var link: String?
    private(set) var busy = false
    private(set) var problem: Problem?
    /// This device was revoked or the account deleted: back to sign-in.
    private(set) var signedOut = false

    private let account: Account
    private var failed: (() async -> Void)?

    init(account: Account) {
        self.account = account
    }

    func load() async {
        let account = account
        await perform(again: { await self.load() }) {
            let (me, link) = try await offMain { (try account.me(), try account.inviteLink()) }
            self.me = me
            self.link = link
        }
    }

    /// A new link, which ends the one before.
    func newLink() async {
        let account = account
        await perform(again: { await self.newLink() }) {
            self.link = try await offMain { try account.rotateInvite() }
        }
    }

    func revoke(deviceId: String) async {
        let account = account
        await perform(again: { await self.revoke(deviceId: deviceId) }) {
            let current = self.me?.devices.contains { $0.deviceId == deviceId && $0.current } ?? false
            try await offMain { try account.revokeDevice(deviceId: deviceId) }
            if current {
                self.signedOut = true
            } else {
                self.me = try await offMain { try account.me() }
            }
        }
    }

    func deleteAccount() async {
        let account = account
        await perform(again: { await self.deleteAccount() }) {
            try await offMain { try account.deleteAccount() }
            self.signedOut = true
        }
    }

    /// Tries the action that failed again.
    func retry() async {
        await failed?()
    }

    /// Runs `action`, one at a time; on failure, `again` is what `retry` repeats.
    private func perform(again: @escaping () async -> Void, _ action: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        problem = nil
        do {
            try await action()
            failed = nil
        } catch {
            failed = again
            problem = Problem(error)
        }
        busy = false
    }
}
