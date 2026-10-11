import Foundation
import Observation
import SpjallCore

/// The conversation list (decision 0022): the core's summaries, read again
/// whenever an event may have changed one, and the socket's connection line.
/// An invite link opened while signed in opens its 1:1 from here. A search
/// finds conversations by the start of a name (decision 0038), on this
/// device, then people in the directory (decision 0036) without anyone whose
/// 1:1 is already among them, once the typing pauses as it does in the
/// new-conversation picker. A row says when someone is typing in its
/// conversation, for as long as the conversation itself would (decision 0043),
/// and a long press mutes it as its own menu does (decision 0042).
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
    /// The conversations someone is typing in; a row shows no name, only that (decisions 0043, 0022).
    private(set) var typing: Set<String> = []

    /// A search shows its results in place of the list.
    var searched: Bool { !trimmed.isEmpty }
    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    var connection: Connection { live.connection }

    private let account: Account
    private let live: Live
    private var reading = false
    private var readAgain = false
    /// Per conversation, the wait that stops showing a typing frame no other follows.
    @ObservationIgnored private var typingShown: [String: Task<Void, Never>] = [:]
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
            // One call: the core leaves out of the people anyone whose 1:1 is among the conversations (0038).
            let list = try await offMain { try account.searchList(query, limit: Self.page) }
            guard query == trimmed else { return }
            found = Found(query: query, conversations: list.conversations, people: list.people)
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
            if case .typing(let conversation, let active) = event {
                showTyping(conversation, active)
                continue
            }
            await load()
        }
    }

    /// Mutes `conversation` for `duration` (decision 0042), as the conversation's own menu does.
    func mute(_ conversation: String, for duration: MuteFor) async {
        let account = account
        await change { _ = try account.mute(conversation, for: duration) }
    }

    /// Turns `conversation`'s notifications back on.
    func unmute(_ conversation: String) async {
        let account = account
        await change { try account.unmute(conversation) }
    }

    /// A change to one conversation, then the list read again; a failure is said, so no one believes it.
    private func change(_ call: @escaping @Sendable () throws -> Void) async {
        problem = nil
        do {
            try await offMain(call)
            await load()
        } catch {
            problem = Problem(error)
        }
    }

    private func showTyping(_ conversation: String, _ active: Bool) {
        typingShown.removeValue(forKey: conversation)?.cancel()
        if active { typing.insert(conversation) } else { typing.remove(conversation) }
        guard active else { return }
        // As long as the conversation shows it: a frame that never ends stops showing.
        typingShown[conversation] = Task { [sleep] in
            guard (try? await sleep(ConversationModel.typingShown)) != nil else { return }
            self.typingShown[conversation] = nil
            self.typing.remove(conversation)
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
