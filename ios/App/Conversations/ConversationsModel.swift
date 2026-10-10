import Foundation
import Observation
import SpjallCore

/// The conversation list (decision 0022): the core's summaries, read again
/// whenever an event may have changed one, and the socket's connection line.
/// An invite link opened while signed in opens its 1:1 from here. A search
/// finds conversations by the start of a name (decision 0038), on this
/// device, then people in the directory (decision 0036), once the typing
/// pauses as it does in the new-conversation picker.
@MainActor @Observable
final class ConversationsModel {
    /// What a search found: conversations first, then people from the directory.
    struct Found {
        let query: String
        var conversations: [Conversation]
        var people: [Person]
    }

    private(set) var conversations: [Conversation] = []
    /// False until the first read, so the empty state does not flash.
    private(set) var loaded = false
    private(set) var problem: Problem?
    /// The invite link last opened is dead; shown until another is opened.
    private(set) var inviteExpired = false
    /// The search as typed; `search()` looks for it.
    var query = ""
    /// What the search last found; nil without a search.
    private(set) var found: Found?
    /// A search is on its way.
    private(set) var searching = false

    /// A search shows its results in place of the list.
    var searched: Bool { !trimmed.isEmpty }
    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    var connection: Connection { live.connection }

    private let account: Account
    private let live: Live
    private var reading = false
    private var readAgain = false
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

    /// Looks for `query` once the typing pauses; a newer search cancels the task.
    func search() async {
        let query = trimmed
        guard !query.isEmpty else {
            found = nil
            searching = false
            return
        }
        searching = true
        do { try await sleep(.milliseconds(300)) } catch { return }
        let account = account
        problem = nil
        do {
            let conversations = try await offMain { try account.searchConversations(query) }
            guard query == trimmed else { return }
            found = Found(query: query, conversations: conversations, people: found?.people ?? [])
            let people = try await offMain { try account.directory(query: query, after: nil, limit: Self.page) }.people
            guard query == trimmed else { return }
            found = Found(query: query, conversations: conversations, people: people)
        } catch {
            problem = Problem(error)
        }
        searching = false
    }

    /// Into the 1:1 with someone the search found, made when there is none; its id.
    func openPerson(_ person: String) async -> String? {
        let account = account
        do {
            let id = try await offMain { try account.openDirect(person) }
            live.sync()
            await load()
            return id
        } catch {
            problem = Problem(error)
            return nil
        }
    }

    /// Reads the list again, and searches again when a search is shown.
    func retry() async {
        await load()
        if searched { await search() }
    }

    /// The people a search shows: a screenful and some.
    private nonisolated static let page: UInt32 = 30

    /// Reads the list, then again after each event but typing, for as long as the screen shows.
    func follow() async {
        let events = live.events()
        await load()
        for await event in events {
            if case .typing = event { continue }
            await load()
        }
    }

    /// Reads the list. Asked for during a read, it reads once more after it.
    func load() async {
        guard !reading else {
            readAgain = true
            return
        }
        reading = true
        repeat {
            readAgain = false
            await read()
        } while readAgain
        reading = false
    }

    /// An invite link, opened while signed in: the 1:1 with whoever made it, to go into.
    func openInvite(token: String) async -> String? {
        inviteExpired = false
        let account = account
        do {
            let id = try await offMain { try account.openInvite(token: token) }
            live.sync()
            await load()
            return id
        } catch {
            if error.isNotFound {
                inviteExpired = true
            } else if case CoreError.Invalid = error {
                // The operator's link, or this account's own: no 1:1 to open.
            } else {
                problem = Problem(error)
            }
            return nil
        }
    }

    private func read() async {
        let account = account
        do {
            conversations = try await offMain { try account.conversations() }
            problem = nil
            // The conversations a search found change with the list; the people it found do not.
            if let query = found?.query {
                let again = try await offMain { try account.searchConversations(query) }
                if found?.query == query { found?.conversations = again }
            }
        } catch {
            problem = Problem(error)
        }
        loaded = true
    }
}
