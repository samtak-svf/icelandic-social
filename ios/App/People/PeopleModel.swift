import Foundation
import Observation
import SpjallCore

/// The new-conversation picker (decisions 0022, 0036): the people met through
/// a shared conversation, then everyone else signed in, a page at a time, and
/// a name search over the whole directory. A tap on a person opens the 1:1
/// with them at once, made when there is none (decision 0043); "new group"
/// switches to picking several, who start a group.
@MainActor @Observable
final class PeopleModel {
    /// The people met through a shared conversation.
    private(set) var people: [Person] = []
    /// The search as typed; `search()` asks the directory for it.
    var query = ""
    /// The directory's pages so far, for `query`.
    private(set) var directory: [Person] = []
    /// The cursor of the directory's next page, nil on the last.
    private(set) var next: String?
    /// A search or a further page is on its way.
    private(set) var searching = false
    private(set) var loaded = false
    /// Picking several people for a group rather than opening a 1:1 with one.
    private(set) var group = false
    /// Account ids, in the order they were picked.
    private(set) var picked: [String] = []
    private(set) var busy = false
    private(set) var problem: Problem?
    /// The conversation to go into.
    private(set) var opened: String?

    private let account: Account
    private let live: Live
    private var failed: (() async -> Void)?
    private let sleep: @Sendable (Duration) async throws -> Void

    init(
        account: Account,
        live: Live,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        self.account = account
        self.live = live
        self.sleep = sleep
    }

    /// Whom the list shows below `people`: without a search, the people met are not shown twice.
    var everyone: [Person] {
        guard query.trimmingCharacters(in: .whitespaces).isEmpty else { return directory }
        let met = Set(people.map(\.account))
        return directory.filter { !met.contains($0.account) }
    }

    func load() async {
        let account = account
        await perform(again: { await self.load() }) {
            let (people, page) = try await offMain {
                (try account.people(), try account.directory(query: nil, after: nil, limit: Self.page))
            }
            self.people = people
            self.directory = page.people
            self.next = page.next
            self.loaded = true
        }
    }

    /// To picking several people for a group.
    func pickGroup() {
        group = true
    }

    /// Back to opening a 1:1 with one tap; the picks go.
    func single() {
        group = false
        picked = []
    }

    /// Into the 1:1 with `person`, made when there is none, into `opened`.
    func open(_ person: String) async {
        let account = account
        await perform(again: { await self.open(person) }) {
            let id = try await offMain { try account.openDirect(person) }
            self.live.sync()
            self.opened = id
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

    /// Asks the directory for `query` once the typing pauses; a newer search cancels the task.
    func search() async {
        do { try await sleep(.milliseconds(300)) } catch { return }
        await page(after: nil)
    }

    /// The directory's next page, if there is one and none is on its way.
    func more() async {
        guard let next, !searching else { return }
        await page(after: next)
    }

    /// A page of the directory for `query`: the first replaces what was shown, a later one adds to it.
    private func page(after: String?) async {
        let account = account
        let query = query.trimmingCharacters(in: .whitespaces)
        searching = true
        problem = nil
        do {
            let page = try await offMain {
                try account.directory(query: query.isEmpty ? nil : query, after: after, limit: Self.page)
            }
            guard query == self.query.trimmingCharacters(in: .whitespaces) else {
                searching = false
                return
            }
            directory = after == nil ? page.people : directory + page.people
            next = page.next
            failed = nil
        } catch {
            failed = { await self.page(after: nil) }
            problem = Problem(error)
        }
        searching = false
    }

    /// A directory page: a screenful and some.
    private nonisolated static let page: UInt32 = 30

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
