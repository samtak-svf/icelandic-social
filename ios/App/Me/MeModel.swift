import Foundation
import Observation
import os
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

    private static let timing = Logger(subsystem: Bundle.main.bundleIdentifier ?? "app", category: "load")

    private let account: Account
    private var failed: (() async -> Void)?

    init(account: Account) {
        self.account = account
    }

    func load() async {
        let account = account
        await perform(again: { await self.load() }) {
            // Each answer is shown as it arrives (decision 0113): what is local at once, then the profile
            // and the blocked list, which ask the server and do not wait for each other.
            let clock = ContinuousClock()
            let start = clock.now
            async let profile = offMain { try account.me() }
            async let people = offMain { try account.blocked() }
            let (link, settings) = try await offMain { (try account.inviteLink(), try account.settings()) }
            self.link = link
            self.settings = settings
            self.me = try await profile
            let meMs = Int((clock.now - start) / .milliseconds(1))
            Self.timing.info("me=\(meMs, privacy: .public)ms")
            self.blocked = try await people
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

    /// "Skrá út" (decision 0047): revokes this device, as "Aftengja" on it did before; the screen has asked
    /// first.
    func signOut() async {
        guard let current = me?.devices.first(where: \.current) else { return }
        await revoke(deviceId: current.deviceId)
    }

    /// The device list offers "Aftengja" on the account's other devices only; this one signs out with
    /// "Skrá út" (decision 0047).
    nonisolated static func revocable(_ device: AccountDevice) -> Bool {
        !device.current
    }

    /// Sets the photo `make` gives, a master as chosen, at most 2400 pixels long (decisions 0039, 0086), then
    /// `framing`, which the person made in the crop sheet; its file is deleted once the core has sent it, or failed
    /// to. Trying again makes it again from the pick.
    func setPhoto(_ make: @escaping @Sendable () async throws -> URL, framing: Framing? = nil) async {
        let account = account
        await perform(again: { await self.setPhoto(make, framing: framing) }) {
            let file = try await make()
            defer { try? FileManager.default.removeItem(at: file) }
            self.me = try await offMain {
                _ = try account.setPhoto(path: file.path)
                if let framing { _ = try account.setPhotoFraming(framing) }
                return try account.me()
            }
        }
    }

    /// The master of the photo in a new temporary file with its framing, for the crop sheet to frame again
    /// (decision 0086); nil, with the problem `.noMaster`, for a photo set before masters were kept. The caller
    /// deletes the file.
    func photoMaster() async -> (file: URL, framing: Framing?)? {
        guard !busy else { return nil }
        let account = account
        var found: (URL, Framing?)?
        await perform(again: { _ = await self.photoMaster() }) {
            let path = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".webp")
            let framing = try await offMain { () throws -> Framing? in
                guard try account.photoSource(path: path.path) else { throw CoreError.NoMaster }
                return try account.photoFraming()
            }
            found = (path, framing)
        }
        return found.map { (file: $0.0, framing: $0.1) }
    }

    /// Frames the photo again from its master, with no new upload (decision 0086).
    func reframePhoto(_ framing: Framing) async {
        let account = account
        await perform(again: { await self.reframePhoto(framing) }) {
            self.me = try await offMain {
                _ = try account.setPhotoFraming(framing)
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
