import Foundation
import Observation
import SpjallCore

/// One community (decision 0063): who may read and write in it, joining, asking to join, taking the request
/// back and leaving, and its posts, newest first, each with a reaction to toggle. A member who is not muted
/// writes a post at the top, of text, up to four images (0065), or both; this account's own posts can be deleted.
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
    /// The images picked for it, as local copies, in their order.
    private(set) var images: [String] = []
    /// Why the last image picked or sent was not taken, until the next is picked or the post goes.
    private(set) var imageNotice: ImageNotice?
    /// This account's id: its own posts can be deleted. Nil until it is known, when none is.
    private(set) var me: String?
    private(set) var busy = false
    /// The owner deleted the community from here, so the screen leaves it.
    private(set) var deleted = false
    private(set) var problem: Problem?

    private let social: Social
    private let now: @Sendable () -> UInt64
    private var failed: (() async -> Void)?
    /// The posts whose reaction is on its way, so a second tap waits for the first.
    private var reacting: Set<String> = []
    /// The media id of each picked image already uploaded, by its local copy, so a retry does not send it again.
    private var uploaded: [String: String] = [:]

    /// Why an image did not go with the post.
    enum ImageNotice: Equatable, Sendable {
        /// A fifth one was picked.
        case tooMany
        /// Over the server's 10 MB.
        case tooLarge
        /// Not an image the server takes, or one that could not be read.
        case invalid
    }

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

    /// This account owns the community, and may delete it (#364).
    var owns: Bool { community?.role == .owner }

    /// A moderator declined this account's join request, and it may not ask again yet (decision 0070): until
    /// when, in Unix milliseconds; nil when it may.
    var declinedUntil: UInt64? {
        guard let until = community?.joinDeclinedUntil, until > now() else { return nil }
        return until
    }

    /// The join requests that wait, for a moderator; zero when none, or when this account does not moderate.
    var pendingRequests: Int {
        guard moderates else { return 0 }
        return Int(community?.pendingJoinRequests ?? 0)
    }

    /// The draft may be sent: something written, an image picked, or both, and the text not over the limit.
    var sendable: Bool {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return writes && (!body.isEmpty || !images.isEmpty) && body.count <= Self.postLimit
    }

    /// The post or comment is this account's own, which it may delete.
    func mine(_ author: Author) -> Bool { me != nil && author.accountId == me }

    func load() async {
        let social = social
        let id = communityId
        await perform(again: { await self.load() }) {
            let community = try await offMain { try social.community(id) }
            self.community = community
            try await self.first()
            self.loaded = true
            await self.whoAmI()
        }
    }

    /// This account's id, once. Quiet: without it no post is offered for deleting.
    private func whoAmI() async {
        guard me == nil else { return }
        let social = social
        me = try? await offMain { try social.me().accountId }
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

    /// Takes back the request to join that waits; then the community as it is now.
    func withdraw() async {
        let social = social
        let id = communityId
        await perform(again: { await self.withdraw() }) {
            let community = try await offMain { () -> Community in
                try social.withdrawJoinRequest(id)
                return try social.community(id)
            }
            self.community = community
            try await self.first()
        }
    }

    /// Deletes the community, which only its owner may do; it can be restored for 30 days. The screen then
    /// leaves it.
    func deleteCommunity() async {
        guard owns else { return }
        let social = social
        let id = communityId
        await perform(again: { await self.deleteCommunity() }) {
            try await offMain { try social.deleteCommunity(id) }
            self.deleted = true
        }
    }

    /// Whether another image fits in the post; when none does, says so instead of opening the picker.
    func roomForImage() -> Bool {
        let room = images.count < Self.imageCount
        if !room { imageNotice = .tooMany }
        return room
    }

    /// How many more images the post takes.
    var imagesLeft: Int { max(0, Self.imageCount - images.count) }

    /// Adds the image picked to the post, as a local copy that can be shown and sent. One over 10 MB, or past
    /// the fourth, is refused with a sentence and its copy deleted.
    func pick(_ picked: Picked) async {
        guard roomForImage() else { return }
        if (picked.size ?? 0) > Self.imageLimit {
            imageNotice = .tooLarge
            return
        }
        imageNotice = nil
        do {
            let file = try await picked.read()
            let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?
                .int64Value
            if (size ?? 0) > Self.imageLimit {
                try? FileManager.default.removeItem(at: file)
                imageNotice = .tooLarge
                return
            }
            guard images.count < Self.imageCount else {
                try? FileManager.default.removeItem(at: file)
                imageNotice = .tooMany
                return
            }
            images.append(file.path)
        } catch {
            imageNotice = .invalid
        }
    }

    /// Takes a picked image out of the post, and deletes its copy.
    func unpick(_ path: String) {
        images.removeAll { $0 == path }
        uploaded[path] = nil
        imageNotice = nil
        try? FileManager.default.removeItem(atPath: path)
    }

    /// Uploads each picked image not yet uploaded, then publishes the draft with them at the top of the posts;
    /// the box empties. An image the server refuses is named, and nothing is posted.
    func publish() async {
        guard sendable, !busy else { return }
        let social = social
        let id = communityId
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let picked = images
        busy = true
        problem = nil
        imageNotice = nil
        do {
            for path in picked where uploaded[path] == nil {
                uploaded[path] = try await offMain { try social.uploadPostImage(id, path: path).mediaId }
            }
            let media = picked.compactMap { uploaded[$0] }
            let post = try await offMain { try social.createPost(id, body: body, media: media) }
            for path in picked { try? FileManager.default.removeItem(atPath: path) }
            uploaded = [:]
            images = []
            posts.insert(post, at: 0)
            draft = ""
            failed = nil
        } catch {
            // A media id the server no longer knows (over a day old): the next try uploads again.
            if case CoreError.Refused(_, "invalid_media", _) = error { uploaded = [:] }
            if let notice = Self.notice(for: error) {
                failed = nil
                imageNotice = notice
            } else {
                failed = { await self.publish() }
                problem = Problem(error)
            }
        }
        busy = false
    }

    /// What the server's refusal of an image says, or nil when it is not about an image.
    private nonisolated static func notice(for error: Error) -> ImageNotice? {
        switch error {
        case CoreError.Refused(_, "too_large", _): .tooLarge
        case CoreError.Refused(_, "invalid_image", _): .invalid
        default: nil
        }
    }

    /// Deletes this account's own post; it leaves the list.
    func delete(_ postId: String) async {
        let social = social
        await perform(again: { await self.delete(postId) }) {
            try await offMain { try social.deletePost(postId) }
            self.posts.removeAll { $0.postId == postId }
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
        // A post shown in the span the newest page covers but missing from it was deleted since, as one deleted
        // from its own screen is; the whole list when that page is the last.
        let oldest = page.next == nil ? 0 : (page.posts.last?.createdAt ?? UInt64.max)
        let kept = posts.filter { fresh[$0.postId] != nil || $0.createdAt <= oldest }
        posts = page.posts.filter { !shown.contains($0.postId) } + kept.map { fresh[$0.postId] ?? $0 }
    }

    /// The longest post the server takes.
    nonisolated static let postLimit = 5_000

    /// The most images one post holds (decision 0065).
    nonisolated static let imageCount = 4

    /// The largest image the server takes for a post, 10 MB.
    nonisolated static let imageLimit: Int64 = 10 * 1_024 * 1_024

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
