import Foundation
import Observation
import SpjallCore

/// One community (decision 0063): who may read and write in it, joining, asking to join and leaving, and its
/// posts, newest first, each with a reaction to toggle. A member who is not muted writes a post at the top.
@MainActor @Observable
final class CommunityModel {
    let communityId: String
    private(set) var community: Community?
    /// Its posts so far, newest first.
    private(set) var posts: [Post] = []
    /// The cursor of the next, older page, nil on the last.
    private(set) var next: String?
    /// A further page is on its way.
    private(set) var paging = false
    private(set) var loaded = false
    /// The post being written.
    var draft = ""
    private(set) var busy = false
    private(set) var problem: Problem?

    private let social: Social
    private let now: @Sendable () -> UInt64
    private var failed: (() async -> Void)?
    /// The posts whose reaction is on its way, so a second tap waits for the first.
    private var reacting: Set<String> = []

    init(social: Social, communityId: String, now: @escaping @Sendable () -> UInt64 = nowMillis) {
        self.social = social
        self.communityId = communityId
        self.now = now
    }

    /// This account may read the posts: it is a member, or the community is open.
    var reads: Bool {
        guard let community else { return false }
        return community.role != nil || community.audience == .open
    }

    /// This account may post, comment and react here.
    var writes: Bool { community.map { canWrite($0, now: now()) } ?? false }

    /// A moderator muted this account here, so it reads but does not write.
    var muted: Bool { community.map { isMuted($0, now: now()) } ?? false }

    /// This account moderates here, and sees the report queue.
    var moderates: Bool { community?.role == .owner || community?.role == .moderator }

    /// The draft may be sent: something written, and not over the limit.
    var sendable: Bool {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return writes && !body.isEmpty && body.count <= Self.postLimit
    }

    func load() async {
        let social = social
        let id = communityId
        await perform(again: { await self.load() }) {
            let community = try await offMain { try social.community(id) }
            self.community = community
            try await self.first()
            self.loaded = true
        }
    }

    /// The posts' next, older page, if there is one and none is on its way.
    func more() async {
        guard let next, !paging, !busy else { return }
        let social = social
        let id = communityId
        paging = true
        problem = nil
        do {
            let page = try await offMain { try social.communityPosts(id, before: next, limit: Self.page) }
            let shown = Set(posts.map(\.postId))
            posts += page.posts.filter { !shown.contains($0.postId) }
            self.next = page.next
            failed = nil
        } catch {
            failed = { await self.more() }
            problem = Problem(error)
        }
        paging = false
    }

    /// Joins an open community at once, or asks a private one's moderators to let this account in.
    func join() async {
        let social = social
        let id = communityId
        await perform(again: { await self.join() }) {
            let community = try await offMain { () -> Community in
                _ = try social.joinCommunity(id)
                return try social.community(id)
            }
            self.community = community
            try await self.first()
        }
    }

    func leave() async {
        let social = social
        let id = communityId
        await perform(again: { await self.leave() }) {
            let community = try await offMain { () -> Community in
                try social.leaveCommunity(id)
                return try social.community(id)
            }
            self.community = community
            try await self.first()
        }
    }

    /// Publishes the draft at the top of the posts.
    func publish() async {
        guard sendable else { return }
        let social = social
        let id = communityId
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        await perform(again: { await self.publish() }) {
            let post = try await offMain { try social.createPost(id, body: body) }
            self.posts.insert(post, at: 0)
            self.draft = ""
        }
    }

    /// Sets this account's reaction on a post to `kind`, or takes it off when it is `kind` already. The post
    /// shows the change at once and goes back to what it was if the server refuses.
    func react(_ postId: String, _ kind: ReactionKind) async {
        guard writes, !reacting.contains(postId), let index = posts.firstIndex(where: { $0.postId == postId })
        else { return }
        let before = posts[index]
        let off = before.myReaction == kind
        posts[index] = reacted(before, off ? nil : kind)
        reacting.insert(postId)
        let social = social
        problem = nil
        do {
            try await offMain {
                if off { try social.unreact(postId) } else { try social.react(postId, kind: kind) }
            }
            failed = nil
        } catch {
            if let index = posts.firstIndex(where: { $0.postId == postId }) { posts[index] = before }
            failed = nil
            problem = Problem(error)
        }
        reacting.remove(postId)
    }

    /// The newest page again, once a post opened from here is closed: the posts on it take their reactions and
    /// comment counts as they are now, and any newer post goes on top. Quiet: a failure leaves what is shown.
    func refresh() async {
        guard loaded, reads, !busy, !paging else { return }
        let social = social
        let id = communityId
        guard let page = try? await offMain({ try social.communityPosts(id, before: nil, limit: Self.page) })
        else { return }
        let fresh = Dictionary(page.posts.map { ($0.postId, $0) }, uniquingKeysWith: { first, _ in first })
        let shown = Set(posts.map(\.postId))
        posts = page.posts.filter { !shown.contains($0.postId) } + posts.map { fresh[$0.postId] ?? $0 }
    }

    /// The longest post the server takes.
    nonisolated static let postLimit = 5_000

    /// The newest page of posts, when this account may read them; none otherwise.
    private func first() async throws {
        guard reads else {
            posts = []
            next = nil
            return
        }
        let social = social
        let id = communityId
        let page = try await offMain { try social.communityPosts(id, before: nil, limit: Self.page) }
        posts = page.posts
        next = page.next
    }

    /// A page of posts: a screenful and some.
    private nonisolated static let page: UInt32 = 20

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
