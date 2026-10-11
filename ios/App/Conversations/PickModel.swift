import Foundation
import Observation
import SpjallCore

/// The conversation picker: the list, to pick one or several conversations from, and what to do in each.
/// A forward (decision 0041) and a shared post (decision 0040) differ only in `deliver`, run once per
/// picked conversation, in the list's order. One that fails stops the round; what went stays sent and
/// unpicked, so trying again sends no copy twice. A search narrows the list by name, and `outgoing`
/// shows at the top what is being sent (decision 0043).
@MainActor @Observable
final class PickModel {
    private(set) var conversations: [Conversation] = []
    /// The search as typed; `search()` asks the core for it.
    var query = ""
    /// What the search found among `conversations`; nil without a search.
    private(set) var found: [Conversation]?
    /// What is being sent, once read; nil while it is not, or when it cannot be.
    private(set) var outgoing: Outgoing?
    /// False until the first read, so the empty state does not flash.
    private(set) var loaded = false
    private(set) var picked: Set<String> = []
    private(set) var sending = false
    private(set) var problem: Problem?
    /// How many conversations were sent into, once all the picked ones were.
    private(set) var done: Int?

    @ObservationIgnored private let account: Account
    @ObservationIgnored private let live: Live
    @ObservationIgnored private let except: String?
    @ObservationIgnored private let preview: @Sendable (Account) throws -> Outgoing?
    @ObservationIgnored private let deliver: @Sendable (Account, String) throws -> Void
    @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void
    /// Sent into by an earlier round that then failed, for the count `done` gives.
    @ObservationIgnored private var sentBefore = 0

    /// `except` is the conversation the pick started from, left out of the list; nil offers them all.
    init(
        account: Account,
        live: Live,
        except: String? = nil,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        preview: @escaping @Sendable (Account) throws -> Outgoing? = { _ in nil },
        deliver: @escaping @Sendable (Account, String) throws -> Void
    ) {
        self.account = account
        self.live = live
        self.except = except
        self.sleep = sleep
        self.preview = preview
        self.deliver = deliver
    }

    var canSend: Bool { !picked.isEmpty && !sending }

    /// The rows: what the search found, or every conversation offered.
    var shown: [Conversation] { found ?? conversations }

    func load() async {
        let account = account
        do {
            let all = try await offMain { try account.conversations() }
            conversations = all.filter(offered)
            problem = nil
        } catch {
            problem = Problem(error)
        }
        loaded = true
        if outgoing == nil {
            // Without a preview the pick still works, so a failed read shows nothing rather than a problem.
            let preview = preview
            outgoing = try? await offMain { try preview(account) }
        }
    }

    /// Asks the core for conversations named like `query` once the typing pauses; a newer search cancels
    /// the task. Only those this pick can send into are shown.
    func search() async {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            found = nil
            return
        }
        do { try await sleep(.milliseconds(300)) } catch { return }
        let account = account
        do {
            let matching = try await offMain { try account.searchConversations(query) }
            guard query == self.query.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
            found = matching.filter(offered)
            problem = nil
        } catch {
            problem = Problem(error)
        }
    }

    func toggle(_ conversation: String) {
        guard !sending else { return }
        if picked.contains(conversation) {
            picked.remove(conversation)
        } else {
            picked.insert(conversation)
        }
    }

    func send() async {
        guard canSend else { return }
        let targets = conversations.map(\.id).filter(picked.contains)
        let account = account
        let deliver = deliver
        sending = true
        problem = nil
        // Each one sent is kept even when a later one fails, so it is not picked again.
        let (sent, failure) = await offMainCollecting(targets) { to in try deliver(account, to) }
        if !sent.isEmpty { live.sync() }
        picked.subtract(sent)
        sentBefore += sent.count
        sending = false
        if let failure {
            problem = Problem(failure)
        } else {
            done = sentBefore
        }
    }

    func retry() async {
        await load()
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { await search() }
    }

    /// A conversation this device can send into, other than the one the pick started from.
    private func offered(_ conversation: Conversation) -> Bool {
        conversation.id != except && (conversation.state == .active || conversation.state == .new)
    }
}

/// What a pick sends, shown at its top: the message forwarded, or the post shared as the server holds it.
enum Outgoing: Equatable, Sendable {
    case message(Item)
    case post(Post)
    /// A shared post the server no longer shows.
    case postGone
}

/// Runs `work` for each of `targets` in turn, off the main actor, until one throws:
/// those done, and what stopped it.
private func offMainCollecting(
    _ targets: [String],
    _ work: @escaping @Sendable (String) throws -> Void
) async -> ([String], Error?) {
    await Task.detached(priority: .userInitiated) { () -> ([String], Error?) in
        var sent: [String] = []
        for target in targets {
            do {
                try work(target)
            } catch {
                return (sent, error)
            }
            sent.append(target)
        }
        return (sent, nil)
    }.value
}
