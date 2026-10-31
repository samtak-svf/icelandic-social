import Foundation
import Observation
import SpjallCore

/// This account's own lists (decision 0114): the requests to it and from it, its friends with a sort and a search,
/// and whom it snoozed. Nobody else's list exists anywhere. Every answer reads the three lists again.
@MainActor @Observable
final class FriendsModel {
    private(set) var requests = FriendRequests(incoming: [], sent: [])
    private(set) var page: FriendPage?
    private(set) var snoozes: [Snooze] = []
    private(set) var loaded = false
    private(set) var busy = false
    private(set) var problem: Problem?
    private(set) var sort = FriendSort.newest
    private(set) var query = ""

    /// The people suggested below the lists; it reads and fails on its own.
    let suggestions: SuggestionsModel
    private let social: Social
    private var failed: (() async -> Void)?
    /// The newest list asked for; an older answer that arrives later is dropped.
    private var ticket = 0

    init(social: Social) {
        self.social = social
        suggestions = SuggestionsModel(social: social)
    }

    /// The search has words in it, so an empty list reads "nobody found" rather than "no friends yet".
    var searched: Bool { !query.isEmpty }

    func load() async {
        await run(again: { await self.load() }) {}
    }

    func retry() async { await failed?() }

    func search(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed != query else { return }
        query = trimmed
        await load()
    }

    func choose(_ next: FriendSort) async {
        guard next != sort else { return }
        sort = next
        await load()
    }

    func accept(_ account: String) async { await act { try $0.acceptFriendRequest(account) } }

    func decline(_ account: String) async { await act { try $0.declineFriendRequest(account) } }

    func cancel(_ account: String) async { await act { try $0.cancelFriendRequest(account) } }

    /// Asks a suggested person. They leave the section when it went through, and stay with the problem when not.
    func ask(_ account: String) async {
        await act { _ = try $0.sendFriendRequest(account) }
        if problem == nil { suggestions.drop(account) }
    }

    func unsnooze(_ account: String) async { await act { try $0.unsnoozePerson(account) } }

    private func act(_ change: @escaping @Sendable (Social) throws -> Void) async {
        let social = social
        await run(again: { await self.act(change) }) { try change(social) }
    }

    private func run(again: @escaping () async -> Void, _ change: @escaping @Sendable () throws -> Void) async {
        let social = social
        let (sort, query) = (sort, query)
        ticket += 1
        let mine = ticket
        busy = true
        problem = nil
        do {
            let (requests, page, snoozes) = try await offMain {
                try change()
                return (
                    try social.friendRequests(), try social.friends(sort: sort, query: query.isEmpty ? nil : query),
                    try social.snoozes()
                )
            }
            guard mine == ticket else { return }
            self.requests = requests
            self.page = page
            self.snoozes = snoozes
            failed = nil
        } catch {
            guard mine == ticket else { return }
            failed = again
            problem = Problem(error)
        }
        loaded = true
        busy = false
    }
}
