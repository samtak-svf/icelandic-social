import Foundation
import Observation
import SpjallCore

/// The communities tab (decision 0063): the communities this account is in, a search over every one it may see,
/// and a new community, which only a verified account makes.
@MainActor @Observable
final class CommunitiesModel {
    /// The communities this account is a member of.
    private(set) var mine: [Community] = []
    /// The search as typed; `search()` asks the server for it.
    var query = ""
    /// The search's pages so far, for `query`.
    private(set) var found: [Community] = []
    /// The cursor of the search's next page, nil on the last.
    private(set) var next: String?
    /// A search or a further page is on its way.
    private(set) var searching = false
    private(set) var loaded = false
    /// Kenni vouches for this account, so it may make a community.
    private(set) var verified = false
    private(set) var busy = false
    private(set) var problem: Problem?
    /// The community just made, to go into.
    private(set) var created: String?

    private let social: Social
    private var failed: (() async -> Void)?
    private let sleep: @Sendable (Duration) async throws -> Void

    init(
        social: Social,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        self.social = social
        self.sleep = sleep
    }

    /// Whether a search is typed: the list then shows what it found in place of `mine`.
    var searched: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

    func load() async {
        let social = social
        await perform(again: { await self.load() }) {
            let (verified, mine) = try await offMain { (try social.me().verified, try social.myCommunities()) }
            self.verified = verified
            self.mine = mine
            self.loaded = true
        }
    }

    /// Asks the server for `query` once the typing pauses; a newer search cancels the task.
    func search() async {
        guard searched else {
            found = []
            next = nil
            searching = false
            return
        }
        // Searching from the first key, so "none found" waits for an answer.
        searching = true
        do { try await sleep(.milliseconds(300)) } catch { return }
        await page(after: nil)
    }

    /// The search's next page, if there is one and none is on its way.
    func more() async {
        guard let next, !searching else { return }
        await page(after: next)
    }

    /// Makes a community, its maker its owner, and goes into it. False when the name is blank or too long, or
    /// the description too long.
    @discardableResult
    func create(name: String, description: String, audience: CommunityAudience) async -> Bool {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let description = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard verified, !name.isEmpty, name.count <= Self.nameLimit, description.count <= Self.descriptionLimit
        else { return false }
        let social = social
        var made = false
        await perform(again: { await self.create(name: name, description: description, audience: audience) }) {
            let community = try await offMain {
                try social.createCommunity(name: name, description: description, audience: audience)
            }
            self.mine.insert(community, at: 0)
            self.created = community.communityId
            made = true
        }
        return made
    }

    /// The community made has been gone into.
    func opened() {
        created = nil
    }

    /// The longest name and description a community takes, as the server holds them.
    nonisolated static let nameLimit = 80
    nonisolated static let descriptionLimit = 500

    /// A page of the search for `query`: the first replaces what was shown, a later one adds to it.
    private func page(after: String?) async {
        let social = social
        let query = query.trimmingCharacters(in: .whitespaces)
        searching = true
        problem = nil
        do {
            let page = try await offMain { try social.communities(query: query, after: after, limit: Self.page) }
            guard query == self.query.trimmingCharacters(in: .whitespaces) else {
                searching = false
                return
            }
            found = after == nil ? page.communities : found + page.communities
            next = page.next
            failed = nil
        } catch {
            failed = { await self.page(after: nil) }
            problem = Problem(error)
        }
        searching = false
    }

    /// A search page: a screenful and some.
    private nonisolated static let page: UInt32 = 30

    /// Tries the action that failed again.
    func retry() async {
        await failed?()
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
