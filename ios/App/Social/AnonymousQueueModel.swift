import Foundation
import Observation
import SpjallCore

/// The anonymous posts that wait for approval in a community (decision 0091), newest first. A moderator
/// publishes one, declines it, or asks who wrote it; an answered post leaves the list. Asking who wrote a post is
/// recorded in the community's moderation log with the moderator's name, which the confirmation says.
@MainActor @Observable
final class AnonymousQueueModel {
    nonisolated static let pageSize: UInt32 = 20

    let communityId: String
    private(set) var posts: [Post] = []
    private(set) var next: String?
    private(set) var loaded = false
    /// The post whose answer is on its way, so a second tap waits for the first.
    private(set) var answering: String?
    /// The name of whoever wrote a post, by post id, once a moderator asked.
    private(set) var revealed: [String: Author] = [:]
    private(set) var problem: Problem?

    private let social: Social
    private var failed: (() async -> Void)?

    init(social: Social, communityId: String) {
        self.social = social
        self.communityId = communityId
    }

    func load() async {
        guard answering == nil else { return }
        let social = social
        let id = communityId
        problem = nil
        do {
            let page = try await offMain { try social.pendingAnonymousPosts(id, before: nil, limit: Self.pageSize) }
            posts = page.posts
            next = page.next
            failed = nil
        } catch {
            failed = { await self.load() }
            problem = Problem(error)
        }
        loaded = true
    }

    /// The next page, when the list has one.
    func more() async {
        guard let before = next, answering == nil else { return }
        let social = social
        let id = communityId
        do {
            let page = try await offMain { try social.pendingAnonymousPosts(id, before: before, limit: Self.pageSize) }
            posts += page.posts.filter { found in !posts.contains { $0.postId == found.postId } }
            next = page.next
        } catch {
            failed = { await self.more() }
            problem = Problem(error)
        }
    }

    /// Publishes the post, with no name on it.
    func approve(_ post: Post) async {
        let social = social
        await answer(post, again: { await self.approve(post) }) { try social.approveAnonymousPost(post.postId) }
    }

    /// Declines the post; its author is told.
    func decline(_ post: Post) async {
        let social = social
        await answer(post, again: { await self.decline(post) }) { try social.declineAnonymousPost(post.postId) }
    }

    /// Asks who wrote the post. The answer stays on the card for as long as the list does.
    func reveal(_ post: Post) async {
        guard answering == nil else { return }
        let social = social
        answering = post.postId
        problem = nil
        do {
            revealed[post.postId] = try await offMain { try social.revealAuthor(post.postId) }
            failed = nil
        } catch {
            failed = { await self.reveal(post) }
            problem = Problem(error)
        }
        answering = nil
    }

    /// Tries the action that failed again.
    func retry() async {
        await failed?()
    }

    private func answer(
        _ post: Post, again: @escaping () async -> Void, _ call: @escaping @Sendable () throws -> Void
    ) async {
        guard answering == nil else { return }
        answering = post.postId
        problem = nil
        do {
            try await offMain(call)
            posts.removeAll { $0.postId == post.postId }
            revealed[post.postId] = nil
            failed = nil
        } catch {
            failed = again
            problem = Problem(error)
        }
        answering = nil
    }
}
