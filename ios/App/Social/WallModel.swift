import Foundation
import Observation
import SpjallCore

/// An account's wall (decision 0115): its bio, its posts, what it says about the account and its images. On this
/// account's own wall the bio and the audience of a post can be changed and a post written. A wall that cannot be
/// read still leaves the person's screen standing, as on the web.
@MainActor @Observable
final class WallModel {
    enum Tab: CaseIterable { case posts, about, images }

    /// The longest bio, in code points.
    static let bioLimit = 120
    private nonisolated static let page: UInt32 = 20

    let accountId: String
    private(set) var wall: WallProfile?
    private(set) var posts: [Post] = []
    private(set) var next: String?
    private(set) var postsLoaded = false
    private(set) var images: [CommunityImage] = []
    private(set) var imagesNext: String?
    private(set) var imagesLoaded = false
    var tab = Tab.posts
    /// The post being written, and who may read it.
    var draft = ""
    var audience = WallAudience.friends
    /// The bio while it is being edited; nil when it is not.
    var bioDraft: String?
    /// The images or poll of the post being written, shared with the communities' composer.
    let attachments = PostAttachments()
    /// The suspension in force on this account, set by the screen (decision 0115): a suspended account reads, and
    /// takes its cover away, and writes nothing else here (decision 0116).
    var suspension: AccountSuspension?
    private(set) var busy = false
    private(set) var problem: Problem?

    private let social: Social
    private var failed: (() async -> Void)?
    /// The posts whose reaction or vote is on its way, so a second tap waits for the first.
    private var reacting: Set<String> = []
    private var voting: Set<String> = []

    init(social: Social, accountId: String) {
        self.social = social
        self.accountId = accountId
    }

    func load() async {
        let social = social
        let id = accountId
        busy = true
        problem = nil
        // The profile is best effort: without it the wall still lists its posts.
        wall = try? await offMain { try social.wall(id) }
        do {
            let page = try await offMain { try social.wallPosts(id, before: nil, limit: Self.page) }
            posts = page.posts
            next = page.next
            postsLoaded = true
            failed = nil
        } catch {
            failed = { await self.load() }
            problem = Problem(error)
        }
        busy = false
    }

    func retry() async { await failed?() }

    func more() async {
        guard let cursor = next, !busy else { return }
        let social = social
        let id = accountId
        busy = true
        do {
            let page = try await offMain { try social.wallPosts(id, before: cursor, limit: Self.page) }
            let shown = Set(posts.map(\.postId))
            posts += page.posts.filter { !shown.contains($0.postId) }
            next = page.next
        } catch {
            failed = { await self.more() }
            problem = Problem(error)
        }
        busy = false
    }

    func loadImages() async {
        guard !imagesLoaded else { return }
        await imagePage(cursor: nil)
    }

    func moreImages() async {
        guard let cursor = imagesNext, !busy else { return }
        await imagePage(cursor: cursor)
    }

    private func imagePage(cursor: String?) async {
        let social = social
        let id = accountId
        busy = true
        do {
            let page = try await offMain { try social.wallImages(id, cursor: cursor, limit: Self.page) }
            let shown = Set(images.map(\.mediaId))
            images += page.images.filter { !shown.contains($0.mediaId) }
            imagesNext = page.next
            imagesLoaded = true
        } catch {
            failed = { await self.imagePage(cursor: cursor) }
            problem = Problem(error)
        }
        busy = false
    }

    /// This account may write here: no suspension stands.
    var writes: Bool { mayWrite(suspension) }

    /// The draft may be published: something written (or a poll's question and options, or an image) within the
    /// limits, and no suspension standing.
    var publishable: Bool {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard writes, body.count <= CommunityModel.postLimit else { return false }
        if let fields = attachments.pollFields {
            return attachments.images.isEmpty && CommunityModel.canPublishPoll(question: body, fields: fields)
        }
        return !body.isEmpty || !attachments.images.isEmpty
    }

    /// Writes the draft on this account's own wall, newest first. True once it is posted, so the composer closes.
    @discardableResult
    func publish() async -> Bool {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard publishable, !busy else { return false }
        let social = social
        let audience = audience
        let poll = attachments.pollFields.map { $0.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) } }
        var posted = false
        busy = true
        problem = nil
        attachments.imageNotice = nil
        do {
            let media = try await attachments.mediaIds { path in
                try await offMain { try social.uploadWallImage(path: path).mediaId }
            }
            let created = try await offMain {
                try social.createWallPost(body: body, media: media, poll: poll, audience: audience)
            }
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

    /// Sets this account's reaction on a post to `emoji`, or takes it off when it is `emoji` already. The post
    /// shows the change at once and goes back to what it was if the server refuses.
    func react(_ postId: String, _ emoji: String) async {
        guard writes, !reacting.contains(postId), let index = posts.firstIndex(where: { $0.postId == postId })
        else { return }
        let before = posts[index]
        let off = before.myEmoji == emoji
        posts[index] = reacted(before, off ? nil : emoji)
        reacting.insert(postId)
        let social = social
        problem = nil
        do {
            try await offMain {
                if off { try social.unreact(postId) } else { try social.react(postId, emoji: emoji) }
            }
            failed = nil
        } catch {
            if let index = posts.firstIndex(where: { $0.postId == postId }) { posts[index] = before }
            failed = nil
            problem = Problem(error)
        }
        reacting.remove(postId)
    }

    /// This account may close the poll on `post`: its author, while it is open.
    func canClose(_ post: Post) -> Bool { post.poll.map { !$0.closed } == true && post.mine }

    func vote(_ postId: String, option: String) async {
        let social = social
        await pollAction(postId) { try social.votePoll(postId, option: option) }
    }

    func withdrawVote(_ postId: String) async {
        let social = social
        await pollAction(postId) { try social.withdrawVote(postId) }
    }

    func closePoll(_ postId: String) async {
        let social = social
        await pollAction(postId) { try social.closePoll(postId) }
    }

    private func pollAction(_ postId: String, _ act: @escaping @Sendable () throws -> Post) async {
        guard writes, !voting.contains(postId) else { return }
        voting.insert(postId)
        problem = nil
        let outcome = await runPollAction(social, postId: postId, act)
        if let post = outcome.post, let index = posts.firstIndex(where: { $0.postId == post.postId }) {
            posts[index] = post
        }
        failed = nil
        problem = outcome.problem
        voting.remove(postId)
    }

    /// Changes who may read one of this account's wall posts.
    func setAudience(_ postId: String, _ audience: WallAudience) async {
        guard !busy else { return }
        let social = social
        busy = true
        problem = nil
        do {
            try await offMain { try social.setPostAudience(postId, audience: audience) }
            if let at = posts.firstIndex(where: { $0.postId == postId }) { posts[at].audience = audience }
            failed = nil
        } catch {
            failed = { await self.setAudience(postId, audience) }
            problem = Problem(error)
        }
        busy = false
    }

    /// A bio as it is saved: line breaks read as a space, the ends trimmed.
    static func cleanBio(_ text: String) -> String {
        text.components(separatedBy: .newlines).joined(separator: " ").trimmingCharacters(in: .whitespaces)
    }

    /// The bio being edited fits: at most `bioLimit` code points once cleaned. A blank one fits, and clears.
    var bioFits: Bool { Self.cleanBio(bioDraft ?? "").unicodeScalars.count <= Self.bioLimit }

    func editBio() { bioDraft = wall?.bio ?? "" }

    func cancelBio() { bioDraft = nil }

    /// Saves the bio being edited; a blank one clears it.
    func saveBio() async {
        guard let draft = bioDraft, bioFits, !busy else { return }
        let bio = Self.cleanBio(draft)
        let social = social
        busy = true
        problem = nil
        do {
            try await offMain { try social.setBio(bio) }
            wall?.bio = bio.isEmpty ? nil : bio
            bioDraft = nil
            failed = nil
        } catch {
            failed = { await self.saveBio() }
            problem = Problem(error)
        }
        busy = false
    }

    /// Takes the bio away.
    func removeBio() async {
        bioDraft = ""
        await saveBio()
    }

    // MARK: Cover

    /// What the cover dialog offers (decision 0116): choosing and framing write, so a suspended account is offered
    /// neither; taking the cover away stays, when there is one.
    struct CoverControls: Equatable {
        let pick: Bool
        let reframe: Bool
        let remove: Bool
    }

    var coverControls: CoverControls {
        let has = wall?.cover != nil
        return CoverControls(pick: writes, reframe: writes && has, remove: has)
    }

    /// Frames the cover from the file `make` gives, or sets it as picked when `framing` is nil. The file is
    /// deleted once the core has sent it, or failed to. Only this account's own wall has one to set.
    func setCover(_ make: @escaping @Sendable () async throws -> URL, framing: Framing? = nil) async {
        guard coverControls.pick, !busy else { return }
        let social = social
        let id = accountId
        await cover(again: { await self.setCover(make, framing: framing) }) {
            let file = try await make()
            defer { try? FileManager.default.removeItem(at: file) }
            return try await offMain {
                _ = try social.setWallCover(path: file.path)
                if let framing { _ = try social.setWallCoverFraming(framing) }
                return try social.wall(id)
            }
        }
    }

    /// How the cover is framed now, for the crop sheet to open at.
    var coverFraming: Framing? { wall?.coverFrames }

    /// The master of the cover in a new temporary file, for the crop sheet to frame it again; nil, with the
    /// problem `.noMaster`, for one set before masters were kept. The caller deletes it.
    func coverMaster() async -> URL? {
        guard coverControls.reframe, !busy else { return nil }
        let social = social
        busy = true
        problem = nil
        let path = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".webp")
        do {
            let found = try await offMain { try social.wallCoverSource(path: path.path) }
            guard found else { throw CoreError.NoMaster }
            failed = nil
            busy = false
            return path
        } catch {
            failed = { _ = await self.coverMaster() }
            problem = Problem(error)
            busy = false
            return nil
        }
    }

    /// Frames the cover again from its master, with no new upload.
    func reframeCover(_ framing: Framing) async {
        guard coverControls.reframe, !busy else { return }
        let social = social
        let id = accountId
        await cover(again: { await self.reframeCover(framing) }) {
            try await offMain {
                _ = try social.setWallCoverFraming(framing)
                return try social.wall(id)
            }
        }
    }

    /// Takes the cover away. Allowed while suspended.
    func removeCover() async {
        guard coverControls.remove, !busy else { return }
        let social = social
        let id = accountId
        await cover(again: { await self.removeCover() }) {
            try await offMain {
                try social.removeWallCover()
                return try social.wall(id)
            }
        }
    }

    private func cover(again: @escaping () async -> Void, _ act: () async throws -> WallProfile) async {
        busy = true
        problem = nil
        do {
            wall = try await act()
            failed = nil
        } catch {
            failed = again
            problem = Problem(error)
        }
        busy = false
    }
}
