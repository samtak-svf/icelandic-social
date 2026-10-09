import Foundation
import Observation
import SpjallCore

/// One post and its replies, oldest first (decision 0034). Public, like the post.
@MainActor @Observable
final class RepliesModel {
    let postId: String
    private(set) var post: Post?
    private(set) var replies: [Reply] = []
    private(set) var loaded = false
    private(set) var loadingMore = false
    private(set) var busy = false
    private(set) var problem: Problem?
    /// The post was deleted: nothing to show or reply to.
    private(set) var gone = false
    /// This account's id: its own replies can be deleted.
    private(set) var me: String?

    private let account: Account
    private var next: String?
    private var failed: (() async -> Void)?

    init(account: Account, postId: String) {
        self.account = account
        self.postId = postId
    }

    /// The post and the first page of its replies.
    func load() async {
        let (account, postId) = (account, postId)
        let known = me
        await perform(again: { await self.load() }) {
            do {
                let (me, post, page) = try await offMain {
                    let me = try known ?? account.me().accountId
                    let post = try account.post(postId)
                    return (me, post, try account.replies(postId, after: nil, limit: PostsModel.pageSize))
                }
                self.me = me
                self.post = post
                self.replies = page.replies
                self.next = page.next
                self.loaded = true
            } catch let error where error.isNotFound {
                self.gone = true
                self.loaded = true
            }
        }
    }

    /// The page after the last one shown, if there is one.
    func loadMore() async {
        guard let after = next, !loadingMore, !busy else { return }
        let (account, postId) = (account, postId)
        loadingMore = true
        do {
            let page = try await offMain { try account.replies(postId, after: after, limit: PostsModel.pageSize) }
            let shown = Set(replies.map(\.replyId))
            replies += page.replies.filter { !shown.contains($0.replyId) }
            next = page.next
        } catch {
            failed = { await self.loadMore() }
            problem = Problem(error)
        }
        loadingMore = false
    }

    /// Replies with `body`, which then ends the list; false when it was not sent.
    func send(body: String) async -> Bool {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= PostsModel.maxLength, !gone else { return false }
        let (account, postId) = (account, postId)
        var sent = false
        await perform(again: nil) {
            let reply = try await offMain { try account.createReply(postId, body: text) }
            self.replies.append(reply)
            self.post?.replyCount += 1
            sent = true
        }
        return sent
    }

    func delete(_ replyId: String) async {
        let account = account
        await perform(again: { await self.delete(replyId) }) {
            try await offMain { try account.deleteReply(replyId) }
            self.replies.removeAll { $0.replyId == replyId }
            if let count = self.post?.replyCount, count > 0 { self.post?.replyCount = count - 1 }
        }
    }

    /// A heart on the post, or none: shown at once, and put back if the server says no.
    func toggleHeart() async {
        guard let before = post else { return }
        let reaction: PostReaction? = before.myReaction == nil ? .heart : nil
        post = PostsModel.reacted(before, reaction)
        let (account, postId) = (account, postId)
        do {
            try await offMain { try account.reactToPost(postId, reaction: reaction) }
        } catch {
            post = before
            failed = nil
            problem = Problem(error)
        }
    }

    /// Tries the action that failed again; with nothing to repeat, loads afresh.
    func retry() async {
        if let failed {
            await failed()
        } else {
            await load()
        }
    }

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
