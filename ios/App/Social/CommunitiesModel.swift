import Foundation
import Observation
import SpjallCore

/// The hub's three parts (decision 0079): what is new, what this account is in, and the search. Declared beside the
/// model rather than inside it: it is a value type of its own, holding no part of the model's state.
enum CommunitiesPart: CaseIterable, Identifiable, Sendable {
    /// What is new across this account's communities.
    case feed
    /// The communities this account is in.
    case mine
    /// The search for a community it is not in yet.
    case discover

    var id: Self { self }

    /// Its name on the picker.
    var label: String {
        switch self {
        case .feed: localized("communities_tab_feed")
        case .mine: localized("communities_tab_mine")
        case .discover: localized("communities_tab_discover")
        }
    }
}

/// The communities tab (decision 0063): the feed across the communities this account is in, those communities, a
/// search over every one it may see, and a new community, which only a verified account makes (decision 0079).
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
    /// Which part of the hub is shown.
    var part = CommunitiesPart.feed
    /// The feed's posts so far, newest first, from every community this account is in.
    private(set) var feedPosts: [Post] = []
    /// The cursor of the feed's next, older page, nil on the last.
    private(set) var feedNext: String?
    /// The feed has been asked for, so an empty one says so rather than waiting.
    private(set) var feedLoaded = false
    /// A feed page is on its way.
    private(set) var loadingFeed = false

    private let social: Social
    private var failed: (() async -> Void)?
    private let sleep: @Sendable (Duration) async throws -> Void
    /// The feed posts whose reaction is on its way, so a second tap waits for the first.
    private var reacting: Set<String> = []

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
            self.mine = Self.pinnedFirst(mine)
            self.loaded = true
        }
    }

    /// The communities this account pinned lead, each group in the order the server gave (decision 0080).
    static func pinnedFirst(_ communities: [Community]) -> [Community] {
        communities.filter(\.pinned) + communities.filter { !$0.pinned }
    }

    /// Pins a community to the top of `Mín samfélög`, or takes the pin off, and reads the list again so the order
    /// is the server's.
    func pin(_ communityId: String, _ pinned: Bool) async {
        guard mine.contains(where: { $0.communityId == communityId }) else { return }
        let social = social
        await perform(again: { await self.pin(communityId, pinned) }) {
            try await offMain {
                if pinned { try social.pinCommunity(communityId) } else { try social.unpinCommunity(communityId) }
            }
            let mine = try await offMain { try social.myCommunities() }
            self.mine = Self.pinnedFirst(mine)
        }
    }

    /// The newest page of the feed: the posts of every community this account is in, newest first.
    func loadFeed() async {
        guard !loadingFeed, !feedLoaded else { return }
        await feedPage(before: nil)
    }

    /// The feed's next, older page, if there is one and none is on its way.
    func moreFeed() async {
        guard let before = feedNext, !loadingFeed else { return }
        await feedPage(before: before)
    }

    /// One page of the feed: the first replaces what was shown, a later one adds to it.
    private func feedPage(before: String?) async {
        let social = social
        loadingFeed = true
        problem = nil
        do {
            let page = try await offMain { try social.feed(before: before, limit: Self.feedSize) }
            if before == nil {
                feedPosts = page.posts
            } else {
                let shown = Set(feedPosts.map(\.postId))
                feedPosts += page.posts.filter { !shown.contains($0.postId) }
            }
            feedNext = page.next
            failed = nil
        } catch {
            failed = { await self.feedPage(before: before) }
            problem = Problem(error)
        }
        feedLoaded = true
        loadingFeed = false
    }

    /// This account's community with this id, when it is in it: a feed post's name, and whether it may write there.
    func community(_ id: String) -> Community? {
        mine.first { $0.communityId == id }
    }

    /// This account may react to a feed post: it is a member of the post's community and not muted there.
    func writes(_ post: Post) -> Bool {
        community(post.communityId).map { canWrite($0, now: nowMillis()) } ?? false
    }

    /// Sets this account's reaction on a feed post, shown at once and put back if the server refuses.
    func react(_ postId: String, _ kind: ReactionKind) async {
        guard !reacting.contains(postId), let index = feedPosts.firstIndex(where: { $0.postId == postId }),
            writes(feedPosts[index])
        else { return }
        let before = feedPosts[index]
        let off = before.myReaction == kind
        feedPosts[index] = reacted(before, off ? nil : kind)
        reacting.insert(postId)
        let social = social
        problem = nil
        do {
            try await offMain {
                if off { try social.unreact(postId) } else { try social.react(postId, kind: kind) }
            }
            failed = nil
        } catch {
            if let index = feedPosts.firstIndex(where: { $0.postId == postId }) { feedPosts[index] = before }
            failed = nil
            problem = Problem(error)
        }
        reacting.remove(postId)
    }

    /// Asks the server for `query` once the typing pauses; a newer search cancels the task. Nothing typed is every
    /// community this account may see, which is what `Finna` lists before a word is given.
    func search() async {
        if searched {
            // Searching from the first key, so "none found" waits for an answer.
            searching = true
            do { try await sleep(.milliseconds(300)) } catch {
                // A newer search is the one that answers now.
                searching = false
                return
            }
        }
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
    func create(
        name: String, description: String, audience: CommunityAudience,
        picture: (@Sendable () async throws -> URL)? = nil, cover: (@Sendable () async throws -> URL)? = nil
    ) async -> Bool {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let description = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard verified, !name.isEmpty, name.count <= communityNameLimit,
            description.count <= communityDescriptionLimit
        else { return false }
        let social = social
        var made = false
        await perform(
            again: {
                await self.create(
                    name: name, description: description, audience: audience, picture: picture, cover: cover)
            }
        ) {
            var community = try await offMain {
                try social.createCommunity(name: name, description: description, audience: audience)
            }
            // The community exists from here on: a picture that fails to send is not a reason to make it again
            // (the owner sets it in `Breyta samfélagi`), so only the ones that went are drawn.
            let id = community.communityId
            if let picture, let file = try? await picture() {
                defer { try? FileManager.default.removeItem(at: file) }
                if let version = try? await offMain({ try social.setCommunityAvatar(id, path: file.path) }) {
                    community.photo = version
                }
            }
            if let cover, let file = try? await cover() {
                defer { try? FileManager.default.removeItem(at: file) }
                if let version = try? await offMain({ try social.setCommunityCover(id, path: file.path) }) {
                    community.cover = version
                }
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

    /// A page of the search for `query`: the first replaces what was shown, a later one adds to it. Nothing typed
    /// asks for every community this account may see.
    private func page(after: String?) async {
        let social = social
        let query = query.trimmingCharacters(in: .whitespaces)
        searching = true
        problem = nil
        do {
            let page = try await offMain {
                try social.communities(query: query.isEmpty ? nil : query, after: after, limit: Self.page)
            }
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

    /// A feed page: a screenful and some (decision 0079).
    private nonisolated static let feedSize: UInt32 = 20

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
