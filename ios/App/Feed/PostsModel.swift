import Foundation
import Observation
import SpjallCore

/// Fljótið, the person's own wall on "Ég", or another account's wall
/// (decision 0034): public posts, newest first, fetched fresh each time and
/// paged with the server's cursor. What is written here is not encrypted.
@MainActor @Observable
final class PostsModel {
    enum Source: Equatable, Sendable {
        case feed
        case wall(String)
    }

    /// How many posts a page asks for.
    nonisolated static let pageSize: UInt32 = 30
    /// The longest post or reply the server takes.
    nonisolated static let maxLength = 2_000

    let source: Source
    private(set) var posts: [Post] = []
    private(set) var loaded = false
    private(set) var loadingMore = false
    private(set) var busy = false
    private(set) var problem: Problem?
    /// This account's id: its own posts can be deleted.
    private(set) var me: String?
    /// Whose wall this is, when it is another account's.
    private(set) var person: Person?
    /// This account blocked the wall's owner: no way to write to them.
    private(set) var blocked = false

    private let account: Account
    private var next: String?
    private var failed: (() async -> Void)?

    init(account: Account, source: Source) {
        self.account = account
        self.source = source
    }

    /// Another account's wall, which can be written to privately.
    var other: Bool {
        guard case .wall(let owner) = source else { return false }
        return me != nil && owner != me
    }

    /// The first page, in place of what was shown.
    func refresh() async {
        let (account, source) = (account, source)
        let known = me
        await perform(again: { await self.refresh() }) {
            let (me, page, owner, blocked) = try await offMain { () -> (String, PostPage, Person?, Bool) in
                let me = try known ?? account.me().accountId
                let page = try Self.page(account, source, before: nil)
                guard case .wall(let owner) = source, owner != me else { return (me, page, nil, false) }
                let blocked = try account.blocked().contains { $0.account == owner }
                return (me, page, try account.profile(owner), blocked)
            }
            self.me = me
            self.posts = page.posts
            self.next = page.next
            if let owner { self.person = owner }
            self.blocked = blocked
            self.loaded = true
        }
    }

    /// The page after the last one shown, if there is one.
    func loadMore() async {
        guard let before = next, !loadingMore, !busy else { return }
        let (account, source) = (account, source)
        loadingMore = true
        do {
            let page = try await offMain { try Self.page(account, source, before: before) }
            let shown = Set(posts.map(\.postId))
            posts += page.posts.filter { !shown.contains($0.postId) }
            next = page.next
        } catch {
            failed = { await self.loadMore() }
            problem = Problem(error)
        }
        loadingMore = false
    }

    /// Posts `body`, which then leads the list; false when it was not posted.
    func post(body: String) async -> Bool {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= Self.maxLength else { return false }
        let account = account
        var posted = false
        await perform(again: nil) {
            let post = try await offMain { try account.createPost(body: text) }
            self.posts.insert(post, at: 0)
            posted = true
        }
        return posted
    }

    func delete(_ postId: String) async {
        let account = account
        await perform(again: { await self.delete(postId) }) {
            try await offMain { try account.deletePost(postId) }
            self.posts.removeAll { $0.postId == postId }
        }
    }

    /// A heart, or none: shown at once, and put back if the server says no.
    func toggleHeart(_ post: Post) async {
        guard let index = posts.firstIndex(where: { $0.postId == post.postId }) else { return }
        let before = posts[index]
        let reaction: PostReaction? = before.myReaction == nil ? .heart : nil
        posts[index] = Self.reacted(before, reaction)
        let account = account
        do {
            try await offMain { try account.reactToPost(post.postId, reaction: reaction) }
        } catch {
            if let index = posts.firstIndex(where: { $0.postId == post.postId }) { posts[index] = before }
            failed = nil
            problem = Problem(error)
        }
    }

    /// The 1:1 with the wall's owner, made if there is none; its id.
    func contact() async -> String? {
        guard case .wall(let owner) = source, other, !blocked else { return nil }
        let account = account
        var opened: String?
        await perform(again: nil) {
            opened = try await offMain { try account.openDirect(owner) }
        }
        return opened
    }

    /// Tries the action that failed again; with nothing to repeat, loads afresh.
    func retry() async {
        if let failed {
            await failed()
        } else {
            await refresh()
        }
    }

    /// `post` with this account's reaction set to `reaction`, its counts moved to match.
    nonisolated static func reacted(_ post: Post, _ reaction: PostReaction?) -> Post {
        var post = post
        if let old = post.myReaction { post.reactions = counts(post.reactions, old, by: -1) }
        if let reaction { post.reactions = counts(post.reactions, reaction, by: 1) }
        post.myReaction = reaction
        return post
    }

    private nonisolated static func counts(_ counts: ReactionCounts, _ reaction: PostReaction, by step: Int)
        -> ReactionCounts
    {
        var counts = counts
        func moved(_ count: UInt32) -> UInt32 { UInt32(max(0, Int(count) + step)) }
        switch reaction {
        case .heart: counts.heart = moved(counts.heart)
        case .thumbsUp: counts.thumbsUp = moved(counts.thumbsUp)
        case .laugh: counts.laugh = moved(counts.laugh)
        case .wow: counts.wow = moved(counts.wow)
        case .sad: counts.sad = moved(counts.sad)
        }
        return counts
    }

    private nonisolated static func page(_ account: Account, _ source: Source, before: String?) throws -> PostPage {
        switch source {
        case .feed: return try account.feed(before: before, limit: pageSize)
        case .wall(let owner): return try account.wall(account: owner, before: before, limit: pageSize)
        }
    }

    /// Runs `action`, one at a time; on failure, `again` is what `retry` repeats.
    private func perform(again: (() async -> Void)?, _ action: () async throws -> Void) async {
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

extension Post {
    /// Every reaction the post has, of all kinds.
    var reactionTotal: UInt32 {
        reactions.heart + reactions.thumbsUp + reactions.laugh + reactions.wow + reactions.sad
    }
}
