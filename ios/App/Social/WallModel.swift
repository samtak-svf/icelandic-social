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
    private(set) var busy = false
    private(set) var problem: Problem?

    private let social: Social
    private var failed: (() async -> Void)?

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

    /// The draft may be published: something written.
    var publishable: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// Writes the draft on this account's own wall, newest first.
    func publish() async {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !busy else { return }
        let social = social
        let audience = audience
        busy = true
        problem = nil
        do {
            let created = try await offMain { try social.createWallPost(body: body, audience: audience) }
            posts.insert(created, at: 0)
            draft = ""
            failed = nil
        } catch {
            failed = { await self.publish() }
            problem = Problem(error)
        }
        busy = false
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
}
