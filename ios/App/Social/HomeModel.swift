import Foundation
import Observation
import SpjallCore

/// Fljótið (decision 0116): what is new in this account's communities, among its friends and on its own wall, newest
/// first, and the composer on top, which writes on the own wall unless another place is picked. The server reads a
/// window of time at a time, so an empty page is no end: only `End` ends the list.
@MainActor @Observable
final class HomeModel {
    /// Where the composer writes: the own wall, or a community this account may post in.
    enum Place: Hashable { case wall, community(String) }

    /// A page of an empty `More` after another is asked for at most this many times in one go, so a long quiet
    /// stretch cannot hold the screen; the sentinel asks again.
    nonisolated static let emptyPagesInARow = 8
    private nonisolated static let page: UInt32 = 30

    private(set) var posts: [Post] = []
    /// The cursor of the next, older page; nil once the last one is in.
    private(set) var next: String?
    private(set) var loaded = false
    /// Every community this account is in: what a card outside its community names.
    private(set) var mine: [Community] = []
    /// The communities the composer offers beside the wall.
    private(set) var targets: [Community] = []
    var draft = ""
    var audience = WallAudience.friends
    var anonymous = false
    /// Where the next post goes. Another place sends the images again, since an upload belongs to its target.
    var place = Place.wall {
        didSet { if place != oldValue { attachments.forgetUploads() } }
    }
    let attachments = PostAttachments()
    /// The suspension in force on this account, set by the screen (decision 0115).
    var suspension: AccountSuspension?
    private(set) var busy = false
    private(set) var problem: Problem?

    private let social: Social
    private var failed: (() async -> Void)?

    init(social: Social) {
        self.social = social
        switch defaultPostTarget() {
        case .wall(let audience):
            self.audience = audience
        case .community(let id, let anonymous):
            place = .community(id)
            self.anonymous = anonymous
        }
    }

    // MARK: Reading

    /// The first page, the communities for the cards and the composer's picker. A failed picker leaves the wall as
    /// the only place; the feed does not wait for it.
    func load() async {
        let social = social
        guard !busy else { return }
        busy = true
        problem = nil
        async let communities = try? offMain { (try social.myCommunities(), try social.postCommunities()) }
        do {
            let (found, last) = try await Self.fetch(social, before: nil)
            posts = found
            next = last
            loaded = true
            failed = nil
        } catch {
            failed = { await self.load() }
            problem = Problem(error)
        }
        if let (all, offered) = await communities {
            mine = all
            targets = offered
        }
        busy = false
    }

    /// Pull to refresh: the first page and the communities again. The list is replaced only once the page is in, so a
    /// failed refresh leaves what was shown with the problem above it. The web reloads on mount and after a post
    /// alone (`web/src/social/paged.ts:7`), so coming back to the app does not reload.
    func refresh() async { await load() }

    /// Clears the problem whatever failed: a refused reaction has nothing to repeat, and while a problem stands the
    /// sentinel asks for no more pages.
    func retry() async {
        problem = nil
        await failed?()
    }

    /// There is nothing to show and nothing more to ask for: the first page came in and the list has ended. An
    /// empty list with a cursor is a quiet stretch, not an empty feed (decision 0116).
    var isEmptyForGood: Bool { loaded && posts.isEmpty && next == nil }

    /// The list is empty but the server has more to read through.
    var isSearching: Bool { loaded && posts.isEmpty && next != nil && problem == nil }

    /// The sentinel at the foot of the list should ask for the next page now: there is one, nothing is on its way,
    /// and the last try did not fail. It is the sentinel's task id, so it asks again once a busy call is over.
    var wantsMore: Bool { next != nil && !busy && problem == nil }

    /// The next, older page, if there is one and none is on its way.
    func more() async {
        guard let cursor = next, !busy else { return }
        let social = social
        busy = true
        do {
            let (found, last) = try await Self.fetch(social, before: cursor)
            let shown = Set(posts.map(\.postId))
            posts += found.filter { !shown.contains($0.postId) }
            next = last
            failed = nil
        } catch {
            failed = { await self.more() }
            problem = Problem(error)
        }
        busy = false
    }

    /// One call's worth of the feed: pages until one holds a post or the list ends. A page can be empty and still
    /// have more behind it (decision 0116); `emptyPagesInARow` of them in a row hand back the cursor instead.
    private nonisolated static func fetch(_ social: Social, before: String?) async throws -> ([Post], String?) {
        var cursor = before
        for _ in 0..<emptyPagesInARow {
            let asked = cursor
            let page = try await offMain { try social.home(before: asked, limit: Self.page) }
            switch page {
            case .end(let posts): return (posts, nil)
            case .more(let posts, let last):
                if !posts.isEmpty { return (posts, last) }
                cursor = last
            }
        }
        return ([], cursor)
    }

    // MARK: Cards

    /// This account's community with this id.
    func community(_ id: String) -> Community? { mine.first { $0.communityId == id } }

    /// The community a card names (decision 0116): the one a community post comes from, none for a wall post, which
    /// shows its author alone, or for a community this account has no list entry for.
    func heading(_ post: Post) -> Community? {
        post.wallOwner == nil ? community(post.communityId) : nil
    }

    /// This account may react to and vote on a post: a wall's, or one of a community it is in and not muted in.
    func writes(_ post: Post) -> Bool {
        if post.wallOwner != nil { return mayWrite(suspension) }
        return community(post.communityId).map { canWrite($0, now: nowMillis()) && mayWrite(suspension) } ?? false
    }

    /// This account may close the poll on a post: its author, or a moderator of its community, while it is open.
    func canClose(_ post: Post) -> Bool {
        guard let poll = post.poll, !poll.closed else { return false }
        if post.mine { return true }
        let role = post.wallOwner == nil ? community(post.communityId)?.role : nil
        return role == .owner || role == .moderator
    }

    /// Sets this account's reaction on a post to `emoji`, or takes it off when it is `emoji` already. The post
    /// shows the change at once and goes back to what it was if the server refuses.
    func react(_ postId: String, _ emoji: String) async { await actions.react(postId, emoji, actionsHost) }

    /// Votes for `option` in the poll on a post, or changes the vote (decision 0090); the post then reads as the
    /// server sent it back. A poll closed meanwhile shows its results and says so.
    func vote(_ postId: String, option: String) async { await actions.vote(postId, option: option, actionsHost) }

    /// Takes this account's vote back.
    func withdrawVote(_ postId: String) async { await actions.withdrawVote(postId, actionsHost) }

    /// Closes the poll: no more votes, and everyone sees the results.
    func closePoll(_ postId: String) async { await actions.closePoll(postId, actionsHost) }

    private let actions = PostActions()

    private var actionsHost: PostActions.Host {
        PostActions.Host(
            social: social,
            read: { id in self.posts.first { $0.postId == id } },
            write: { post in
                if let at = self.posts.firstIndex(where: { $0.postId == post.postId }) { self.posts[at] = post }
            },
            may: { self.writes($0) },
            settle: {
                self.failed = nil
                self.problem = $0
            })
    }

    // MARK: Composing

    /// The picked community lets its members post without a name (decision 0091).
    var allowsAnonymous: Bool {
        guard case .community(let id) = place else { return false }
        return targets.first { $0.communityId == id }?.anonymousPosts ?? false
    }

    /// Where the post goes, as the core takes it: the audience belongs to the wall, the anonymous choice to a
    /// community that allows it.
    var target: PostTarget {
        switch place {
        case .wall: .wall(audience: audience)
        case .community(let id): .community(communityId: id, anonymous: anonymous && allowsAnonymous)
        }
    }

    /// The draft may be published: words (or a poll's question and options, or an image) within the limits, in a
    /// place that is offered, and no suspension standing.
    var publishable: Bool {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard mayWrite(suspension), body.count <= CommunityModel.postLimit else { return false }
        if case .community(let id) = place, !targets.contains(where: { $0.communityId == id }) { return false }
        if let fields = attachments.pollFields {
            return attachments.images.isEmpty && CommunityModel.canPublishPoll(question: body, fields: fields)
        }
        return !body.isEmpty || !attachments.images.isEmpty
    }

    /// Writes the draft at the picked place, newest first. True once it is posted, so the composer closes.
    @discardableResult
    func publish() async -> Bool {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard publishable, !busy else { return false }
        let social = social
        let target = target
        let poll = attachments.pollFields.map { $0.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) } }
        var posted = false
        busy = true
        problem = nil
        attachments.imageNotice = nil
        do {
            let media = try await attachments.mediaIds { path in
                try await offMain { try social.uploadPostImage(for: target, path: path).mediaId }
            }
            let created = try await offMain { try social.postTo(target, body: body, media: media, poll: poll) }
            attachments.finish()
            posts.insert(created, at: 0)
            draft = ""
            failed = nil
            posted = true
        } catch {
            if case CoreError.Refused(_, "invalid_media", _) = error { attachments.forgetUploads() }
            if let notice = CommunityModel.notice(for: error) {
                failed = nil
                attachments.imageNotice = notice
            } else {
                failed = { _ = await self.publish() }
                problem = Problem(error)
            }
        }
        busy = false
        return posted
    }
}
