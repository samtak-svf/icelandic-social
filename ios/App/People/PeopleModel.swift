import Foundation
import Observation
import SpjallCore

/// The new-conversation picker (decision 0022): the people met through a
/// shared conversation, and no search. One person opens the 1:1 there already
/// is with them; more start a group.
@MainActor @Observable
final class PeopleModel {
    private(set) var people: [Person] = []
    private(set) var loaded = false
    /// Account ids, in the order they were picked.
    private(set) var picked: [String] = []
    private(set) var busy = false
    private(set) var problem: Problem?
    /// The conversation to go into.
    private(set) var opened: String?

    private let account: Account
    private let live: Live
    private var failed: (() async -> Void)?

    init(account: Account, live: Live) {
        self.account = account
        self.live = live
    }

    func load() async {
        let account = account
        await perform(again: { await self.load() }) {
            self.people = try await offMain { try account.people() }
            self.loaded = true
        }
    }

    func toggle(_ person: String) {
        if let index = picked.firstIndex(of: person) {
            picked.remove(at: index)
        } else {
            picked.append(person)
        }
    }

    /// Opens the 1:1 there is with one person, or starts a new conversation, into `opened`.
    func start() async {
        let picked = picked
        guard !picked.isEmpty else { return }
        let account = account
        await perform(again: { await self.start() }) {
            let (id, created) = try await offMain { () -> (String, Bool) in
                if let existing = try Self.existing(picked, in: account.conversations()) { return (existing, false) }
                return (try account.createConversation(with: picked), true)
            }
            if created { self.live.sync() }
            self.opened = id
        }
    }

    /// Tries the action that failed again.
    func retry() async {
        await failed?()
    }

    /// The 1:1 with this one person, if there is one to go back to.
    private nonisolated static func existing(_ picked: [String], in conversations: [Conversation]) -> String? {
        guard picked.count == 1 else { return nil }
        return conversations.first { $0.state != .removed && $0.members.map(\.account) == picked }?.id
    }

    private func perform(again: @escaping () async -> Void, _ action: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        problem = nil
        do {
            try await action()
            failed = nil
        } catch {
            failed = again
            loaded = true
            problem = Problem(error)
        }
        busy = false
    }
}
