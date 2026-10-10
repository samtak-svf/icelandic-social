import Foundation
import Observation
import SpjallCore

/// The conversation picker: the list, to pick one or several conversations from, and what to do in each.
/// A forward (decision 0041) and a shared post (decision 0040) differ only in `deliver`, run once per
/// picked conversation, in the list's order. One that fails stops the round; what went stays sent and
/// unpicked, so trying again sends no copy twice.
@MainActor @Observable
final class PickModel {
    private(set) var conversations: [Conversation] = []
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
    @ObservationIgnored private let deliver: @Sendable (Account, String) throws -> Void
    /// Sent into by an earlier round that then failed, for the count `done` gives.
    @ObservationIgnored private var sentBefore = 0

    /// `except` is the conversation the pick started from, left out of the list; nil offers them all.
    init(
        account: Account,
        live: Live,
        except: String? = nil,
        deliver: @escaping @Sendable (Account, String) throws -> Void
    ) {
        self.account = account
        self.live = live
        self.except = except
        self.deliver = deliver
    }

    var canSend: Bool { !picked.isEmpty && !sending }

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
    }

    /// A conversation this device can send into, other than the one the pick started from.
    private func offered(_ conversation: Conversation) -> Bool {
        conversation.id != except && (conversation.state == .active || conversation.state == .new)
    }
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
