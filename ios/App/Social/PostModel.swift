import Foundation
import Observation
import SpjallCore

/// One post (decision 0063) and its comments, oldest first, with a reaction to toggle and a comment to write
/// for a member of its community who is not muted. This account's own post and comments can be deleted.
@MainActor @Observable
final class PostModel: ScreenModel {
    let postId: String
    private(set) var post: Post?
    /// The post's community, which says whether this account may write here.
    private(set) var community: Community?
    /// Its comments so far, oldest first.
    private(set) var comments: [Comment] = []
    /// The cursor of the next, newer page, nil on the last.
    private(set) var next: String?
    /// A further page is on its way.
    private(set) var paging = false
    var loaded = false
    /// The comment being written.
    var draft = ""
    /// The image picked for it, as a local copy; a comment takes at most one (decision 0082).
    private(set) var image: String?
    /// Why the image picked or sent was not taken, until the next is picked or the comment goes.
    private(set) var imageNotice: CommunityModel.ImageNotice?
    /// The media id of the picked image once uploaded, so a retry does not send it again.
    private var uploaded: String?
    /// The comment this account is answering, which the composer names above it (decision 0071); nil for a
    /// comment on the post itself.
    private(set) var replyingTo: Comment?
    /// This account's id: its own post and comments can be deleted. Nil until it is known.
    private(set) var me: String?
    /// This account's name and photo, for the comment composer's own picture (decision 0080).
    private(set) var myName: String?
    private(set) var myPhoto: PhotoOf?
    /// The post was deleted from here, so the screen goes back to its community.
    private(set) var deleted = false
    var busy = false
    var problem: Problem?

    private let social: Social
    private let now: @Sendable () -> UInt64
    var failed: (() async -> Void)?
    /// The comments whose like is on its way, so a second tap waits for the first.
    private var liking: Set<String> = []

    init(social: Social, postId: String, now: @escaping @Sendable () -> UInt64 = nowMillis) {
        self.social = social
        self.postId = postId
        self.now = now
    }

    /// This account may comment and react: a member, not muted, and the post still shown.
    var writes: Bool {
        // A wall post has no community to be a member of: its readers comment while they can read it (0115).
        if post?.wallOwner != nil { return post?.state == .visible }
        guard let community, post?.state == .visible else { return false }
        return canWrite(community, now: now())
    }

    /// Why this member of the post's community has no comment box on a post still shown.
    var noPostNotice: String? {
        guard post?.wallOwner == nil, post?.state == .visible else { return nil }
        return community.flatMap { noPostNoticeKey($0, now: now()) }
    }

    /// The post or comment is this account's own, which it may delete.
    func mine(_ author: Author) -> Bool { me != nil && author.accountId == me }

    /// The draft may be sent: something written, an image picked, or both, and the text not over the limit.
    var sendable: Bool {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return writes && (!body.isEmpty || image != nil) && textLength(body) <= Self.commentLimit
    }

    /// Takes the image picked for the comment as a local copy. A comment holds one: another is refused with a
    /// sentence, as is one over 10 MB or one that cannot be read.
    func pick(_ picked: Picked) async {
        guard image == nil else {
            imageNotice = .tooMany
            return
        }
        imageNotice = nil
        switch await CommunityModel.readImage(picked) {
        case .failure(let notice):
            imageNotice = notice
        case .success(let file):
            guard image == nil else {
                try? FileManager.default.removeItem(at: file)
                imageNotice = .tooMany
                return
            }
            image = file.path
        }
    }

    /// Takes the picked image out of the comment, and deletes its copy.
    func unpick() {
        if let image { try? FileManager.default.removeItem(atPath: image) }
        image = nil
        uploaded = nil
        imageNotice = nil
    }

    func load() async {
        let social = social
        let id = postId
        await perform(again: { await self.load() }) {
            let (post, community, page) = try await offMain { () -> (Post, Community?, CommentPage?) in
                let post = try social.post(id)
                // A removed post is all its reader gets: it has no comments to ask for, and they are refused.
                if isPostTombstone(post) { return (post, nil, nil) }
                // On a wall post `communityId` is the wall's id, which is no community to read.
                let community = post.wallOwner == nil ? try social.community(post.communityId) : nil
                return (
                    post, community,
                    try social.comments(id, after: nil, limit: Self.page)
                )
            }
            self.post = post
            self.community = community
            self.comments = page?.comments ?? []
            self.next = page?.next
            self.loaded = true
            if self.me == nil, let own = try? await offMain({ try social.me() }) {
                self.me = own.accountId
                self.myName = own.name
                self.myPhoto = own.photoOf
            }
        }
    }

    /// Deletes this account's own post; the screen then goes back to its community.
    func deletePost() async {
        guard let post else { return }
        let social = social
        await perform(again: { await self.deletePost() }) {
            try await offMain { try social.deletePost(post.postId) }
            self.deleted = true
        }
    }

    /// Deletes this account's own comment; it leaves the list, and the post counts one fewer.
    func deleteComment(_ commentId: String) async {
        let social = social
        await perform(again: { await self.deleteComment(commentId) }) {
            try await offMain { try social.deleteComment(commentId) }
            let before = self.comments.count
            self.comments.removeAll { $0.commentId == commentId }
            if self.comments.count < before, let count = self.post?.commentCount, count > 0 {
                self.post?.commentCount = count - 1
            }
            if self.replyingTo?.commentId == commentId { self.replyingTo = nil }
        }
    }

    /// The post is on this account's own wall, whose owner removes comments under it and says who may read it.
    var ownsWall: Bool { me != nil && post?.wallOwner == me }

    /// Removes a comment under a post on this account's own wall, with the reason its writer reads (1 to 500
    /// characters, not blank). Nothing is sent without one.
    func removeWallComment(_ commentId: String, reason: String) async {
        let reason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard ownsWall, !reason.isEmpty, textLength(reason) <= Self.reasonLimit else { return }
        let social = social
        await perform(again: { await self.removeWallComment(commentId, reason: reason) }) {
            try await offMain { try social.removeWallComment(commentId, reason: reason) }
            let before = self.comments.count
            self.comments.removeAll { $0.commentId == commentId }
            if self.comments.count < before, let count = self.post?.commentCount, count > 0 {
                self.post?.commentCount = count - 1
            }
        }
    }

    /// Changes who may read this account's own wall post.
    func setAudience(_ audience: WallAudience) async {
        guard ownsWall, let id = post?.postId else { return }
        let social = social
        await perform(again: { await self.setAudience(audience) }) {
            try await offMain { try social.setPostAudience(id, audience: audience) }
            self.post?.audience = audience
        }
    }

    /// The longest reason for removing a comment.
    static let reasonLimit = Limits.moderationNoteChars

    /// Answers `comment`: the composer says whose comment it is, and what is sent goes under it (decision 0071).
    /// A thread takes one level, so a reply has no reply action of its own.
    func reply(to comment: Comment) {
        guard comment.parentCommentId == nil, !isTombstone(comment) else { return }
        replyingTo = comment
    }

    /// Stops answering, and writes a comment on the post itself again.
    func cancelReply() {
        replyingTo = nil
    }

    /// The comments' next, newer page, if there is one and none is on its way.
    func more() async {
        guard let next, !paging, !busy else { return }
        let social = social
        let id = postId
        paging = true
        problem = nil
        do {
            let page = try await offMain { try social.comments(id, after: next, limit: Self.page) }
            let shown = Set(comments.map(\.commentId))
            comments += page.comments.filter { !shown.contains($0.commentId) }
            self.next = page.next
            failed = nil
        } catch {
            failed = { await self.more() }
            problem = Problem(error)
        }
        paging = false
    }

    /// Sends the draft, as a reply when a comment is being answered. It goes last, as the newest; while newer
    /// pages are still to come it arrives with them.
    func publish() async {
        guard sendable, !busy, let community = post?.communityId else { return }
        let social = social
        let id = postId
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let parent = replyingTo?.commentId
        let picked = image
        busy = true
        problem = nil
        imageNotice = nil
        do {
            if let picked, uploaded == nil {
                uploaded = try await offMain { try social.uploadPostImage(community, path: picked).mediaId }
            }
            let media = uploaded.map { [$0] } ?? []
            let comment = try await offMain {
                try social.createComment(id, body: body, parentCommentId: parent, media: media)
            }
            if self.next == nil { self.comments.append(comment) }
            self.post?.commentCount += 1
            if let picked { try? FileManager.default.removeItem(atPath: picked) }
            image = nil
            uploaded = nil
            draft = ""
            replyingTo = nil
            failed = nil
        } catch {
            // A media id the server no longer knows (over a day old): the next try uploads again.
            if case CoreError.Refused(_, "invalid_media", _) = error { uploaded = nil }
            if let notice = CommunityModel.notice(for: error) {
                failed = nil
                imageNotice = notice
            } else {
                failed = { await self.publish() }
                problem = Problem(error)
            }
        }
        busy = false
    }

    /// Sets this account's reaction to `emoji`, or takes it off when it is `emoji` already, shown at once and
    /// put back if the server refuses.
    func react(_ emoji: String) async { await actions.react(postId, emoji, actionsHost) }

    /// Votes in the post's poll, takes the vote back, or closes the poll (decision 0090); the post then reads as
    /// the server sent it back.
    func vote(_ option: String) async { await actions.vote(postId, option: option, actionsHost) }

    func withdrawVote() async { await actions.withdrawVote(postId, actionsHost) }

    func closePoll() async { await actions.closePoll(postId, actionsHost) }

    private let actions = PostActions()

    private var actionsHost: PostActions.Host {
        PostActions.Host(
            social: social,
            read: { id in self.post?.postId == id ? self.post : nil },
            write: { self.post = $0 },
            may: { _ in self.writes },
            settle: {
                self.failed = nil
                self.problem = $0
            })
    }

    /// This account moderates the post's community, and may pin its posts (decision 0080).
    var moderates: Bool { community?.role == .owner || community?.role == .moderator }

    /// Pins the post to the top of its community's feed, or takes the pin off, and reads the post again.
    func pin(_ pinned: Bool) async {
        guard moderates else { return }
        let social = social
        let id = postId
        let communityId = post?.communityId
        guard let communityId else { return }
        await perform(again: { await self.pin(pinned) }) {
            self.post = try await offMain { () throws -> Post in
                if pinned {
                    try social.pinPost(communityId, post: id)
                } else {
                    try social.unpinPost(communityId, post: id)
                }
                return try social.post(id)
            }
        }
    }

    /// This account may close the post's poll: its author, the owner or a moderator, while it is open.
    var canClosePoll: Bool {
        guard let post, let poll = post.poll, !poll.closed else { return false }
        return post.mine || moderates
    }

    /// Gives a comment this account's one 👍, or takes it back, shown at once and put back if the server refuses
    /// (decision 0080). A removed comment and a reader who may not write here take none.
    func like(_ commentId: String) async {
        guard writes, !liking.contains(commentId),
            let index = comments.firstIndex(where: { $0.commentId == commentId }),
            !isTombstone(comments[index])
        else { return }
        let before = comments[index]
        let off = before.liked
        var after = before
        after.liked = !off
        after.likes = off ? before.likes - min(before.likes, 1) : before.likes + 1
        comments[index] = after
        liking.insert(commentId)
        let social = social
        problem = nil
        do {
            try await offMain {
                if off { try social.unlikeComment(commentId) } else { try social.likeComment(commentId) }
            }
            failed = nil
        } catch {
            if let index = comments.firstIndex(where: { $0.commentId == commentId }) { comments[index] = before }
            failed = nil
            problem = Problem(error)
        }
        liking.remove(commentId)
    }

    /// The longest comment the server takes.
    nonisolated static let commentLimit = Limits.commentChars

    /// A page of comments: a screenful and some.
    private nonisolated static let page: UInt32 = 30
}
