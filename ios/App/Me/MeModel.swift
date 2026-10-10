import Foundation
import Observation
import SpjallCore

/// "Ég" (decisions 0009, 0019, 0022, 0024): who the person is, their invite
/// link, the read-marker and typing toggles, who they blocked, their devices,
/// and deleting the account.
///
/// The link is made only when the person asks for one. Making one ends the
/// link before it, so doing it on its own would silently kill a link another
/// device of the account has already shared.
@MainActor @Observable
final class MeModel {
    private(set) var me: Me?
    private(set) var link: String?
    private(set) var settings: Settings?
    private(set) var blocked: [Person] = []
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
            let (me, link, settings, blocked) = try await offMain {
                (try account.me(), try account.inviteLink(), try account.settings(), try account.blocked())
            }
            self.me = me
            self.link = link
            self.settings = settings
            self.blocked = blocked
        }
    }

    /// A new link, which ends the one before.
    func newLink() async {
        let account = account
        await perform(again: { await self.newLink() }) {
            self.link = try await offMain { try account.rotateInvite() }
        }
    }

    /// Off stops both sending and seeing read markers (decision 0022).
    func readMarkers(_ on: Bool) async {
        await change { $0.readMarkers = on }
    }

    /// Off stops both sending and seeing typing (decision 0022).
    func typing(_ on: Bool) async {
        await change { $0.typing = on }
    }

    func unblock(_ person: String) async {
        let account = account
        await perform(again: { await self.unblock(person) }) {
            self.blocked = try await offMain {
                try account.unblock(person)
                return try account.blocked()
            }
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

    /// Sets the photo `make` gives, already small and square (decision 0039); its file is deleted once the
    /// core has sent it, or failed to. Trying again makes it again from the pick.
    func setPhoto(_ make: @escaping @Sendable () async throws -> URL) async {
        let account = account
        await perform(again: { await self.setPhoto(make) }) {
            let file = try await make()
            defer { try? FileManager.default.removeItem(at: file) }
            self.me = try await offMain {
                _ = try account.setPhoto(path: file.path)
                return try account.me()
            }
        }
    }

    /// Removes the photo, for everyone; the screen has asked first.
    func removePhoto() async {
        let account = account
        await perform(again: { await self.removePhoto() }) {
            self.me = try await offMain {
                try account.removePhoto()
                return try account.me()
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

    private func change(_ edit: @escaping (inout Settings) -> Void) async {
        guard var settings else { return }
        edit(&settings)
        let (account, changed) = (account, settings)
        await perform(again: { await self.change(edit) }) {
            try await offMain { try account.setSettings(changed) }
            self.settings = changed
        }
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
