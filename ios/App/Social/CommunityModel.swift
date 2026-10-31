import Foundation
import Observation
import SpjallCore

/// One community (decision 0063): who may read and write in it, joining, asking to join, taking the request
/// back and leaving, and its posts, newest first, each with a reaction to toggle. A member who is not muted
/// writes a post at the top, of text, up to four images (0065), or both; this account's own posts can be deleted.
/// Its posts can be searched, its member list and moderation log read, and its owner renames it, changes its
/// description or makes it private (decision 0079).
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
    /// The search as typed; `search()` asks the server for it (decision 0079).
    var query = ""
    /// A search is on its way, the typing pause included.
    private(set) var searching = false
    /// The member list, its owner and moderators first (decision 0079).
    private(set) var members: [CommunityMember] = []
    /// The member list has been asked for, so an empty one is an answer rather than a wait.
    private(set) var membersLoaded = false
    /// A moderator's actions here, newest first, as `Aðgerðaskrá` reads them (decision 0079).
    private(set) var log: [ModerationLogEntry] = []
    /// The cursor of the log's next, older page, nil on the last.
    private(set) var logNext: String?
    /// The log has been asked for, so an empty one says so rather than waiting.
    private(set) var logLoaded = false
    private(set) var loadingLog = false
    private(set) var loaded = false
    /// The tab chosen on the community's tab row (decision 0089); `shownTab` is the one actually on screen.
    private(set) var tab: Tab = .discussion
    /// The community's images, newest first, for `Myndir` (decision 0089).
    private(set) var gallery: [CommunityImage] = []
    /// The cursor of the gallery's next, older page, nil on the last.
    private(set) var galleryNext: String?
    /// The gallery has been asked for, so an empty one says so rather than waiting.
    private(set) var galleryLoaded = false
    private(set) var loadingGallery = false
    /// The post being written.
    var draft = ""
    /// The post is written without the author's name and waits for a moderator (decision 0091).
    var anonymous = false
    /// This account's id: its own posts can be deleted. Nil until it is known, when none is.
    private(set) var me: String?
    /// This account's name and photo, for the composer row's own picture (decision 0080).
    private(set) var myName: String?
    private(set) var myPhoto: PhotoOf?
    private(set) var busy = false
    /// The owner deleted the community from here, so the screen leaves it.
    private(set) var deleted = false
    private(set) var problem: Problem?

    private let social: Social
    private let now: @Sendable () -> UInt64
    private let sleep: @Sendable (Duration) async throws -> Void
    private var failed: (() async -> Void)?
    /// The posts whose reaction is on its way, so a second tap waits for the first.
    private var reacting: Set<String> = []
    private var loadingMembers = false
    /// The polls whose vote is on its way, so a second tap waits for the first.
    private var voting: Set<String> = []

    /// The community page's tabs (decision 0089), in the order the row shows them.
    enum Tab: String, CaseIterable, Sendable {
        case discussion, featured, images, members, about
    }

    /// Why an image did not go with the post.
    enum ImageNotice: Error, Equatable, Sendable {
        /// A fifth one was picked.
        case tooMany
        /// Over the server's 10 MB.
        case tooLarge
        /// Not an image the server takes, or one that could not be read.
        case invalid
    }

    init(
        social: Social, communityId: String, now: @escaping @Sendable () -> UInt64 = nowMillis,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        self.social = social
        self.communityId = communityId
        self.now = now
        self.sleep = sleep
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

    /// The reported content that waits in its queue, for a moderator; zero when none, or when this account does
    /// not moderate.
    var openReports: Int {
        guard moderates else { return 0 }
        return Int(community?.openReports ?? 0)
    }

    /// The anonymous posts that wait for approval, for a moderator; zero when none, or when this account does not
    /// moderate (decision 0091).
    var pendingAnonymous: Int {
        guard moderates else { return 0 }
        return Int(community?.pendingAnonymous ?? 0)
    }

    /// The tabs this account sees: all of them for a reader of the community, with `Fest` only while a post is
    /// featured; `Um` alone for one who may not read it (decision 0089).
    var tabs: [Tab] {
        guard reads else { return [.about] }
        return Tab.allCases.filter { $0 != .featured || !featured.isEmpty }
    }

    /// The tab on screen: the chosen one while it is offered, else the first (`Fest` goes when its last post lets go).
    var shownTab: Tab { tabs.contains(tab) ? tab : (tabs.first ?? .about) }

    func select(_ tab: Tab) {
        guard tabs.contains(tab) else { return }
        self.tab = tab
    }

    /// The work waiting for this account here, which `Stjórna` counts in its label (decision 0079).
    var manageCount: Int { openReports + pendingRequests + pendingAnonymous }

    /// A search is typed, so the list shows what it found and an empty one says none was.
    var searched: Bool { sent != nil }

    /// The query the posts on screen answer: nil for the plain list. A search for the same words asks for nothing.
    private var shown: String?

    /// The words the server is asked to match: none for an empty field, which is the plain list.
    private var sent: String? {
        let query = query.trimmingCharacters(in: .whitespaces)
        return query.isEmpty ? nil : query
    }

    /// The images and poll of the post being written, shared with the wall's composer.
    let attachments = PostAttachments()
    var pollFields: [String]? {
        get { attachments.pollFields }
        set { attachments.pollFields = newValue }
    }
    var images: [String] { attachments.images }
    var imageNotice: ImageNotice? { attachments.imageNotice }
    var isPoll: Bool { attachments.isPoll }
    func setPoll(_ on: Bool) { attachments.setPoll(on) }
    func addPollOption() { attachments.addPollOption() }
    func removePollOption(at index: Int) { attachments.removePollOption(at: index) }
    func roomForImage() -> Bool { attachments.roomForImage() }
    var imagesLeft: Int { attachments.imagesLeft }
    func pick(_ picked: Picked) async { await attachments.pick(picked) }
    func unpick(_ path: String) { attachments.unpick(path) }

    /// The draft may be sent: something written, an image picked, or both, and the text not over the limit.
    var sendable: Bool {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard body.count <= Self.postLimit else { return false }
        if let pollFields {
            return writes && images.isEmpty && Self.canPublishPoll(question: body, fields: pollFields)
        }
        return writes && (!body.isEmpty || !images.isEmpty)
    }

    /// This community lets members post without a name (decision 0091).
    var allowsAnonymous: Bool { community?.anonymousPosts ?? false }

    /// A poll needs its question, two to six options, none empty or over 80 characters, none the same as another
    /// when case is ignored (the API's `POLL_OPTIONS`, as the web's `canPublishPoll`).
    nonisolated static func canPublishPoll(question: String, fields: [String]) -> Bool {
        let options = fields.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            (pollMinOptions...pollMaxOptions).contains(options.count),
            !options.contains(where: { $0.isEmpty || $0.count > pollOptionLimit })
        else { return false }
        return Set(options.map { $0.lowercased() }).count == options.count
    }

    nonisolated static let pollMinOptions = 2
    nonisolated static let pollMaxOptions = 6
    nonisolated static let pollOptionLimit = 80

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
        guard let own = try? await offMain({ try social.me() }) else { return }
        me = own.accountId
        myName = own.name
        myPhoto = own.photoOf
    }

    /// The posts' next, older page, if there is one and none is on its way.
    func more() async {
        guard let next, !paging, !searching, !busy else { return }
        let before = next
        paging = true
        problem = nil
        do {
            try await page(before: before, sent)
            failed = nil
        } catch {
            failed = { await self.more() }
            problem = Problem(error)
        }
        paging = false
    }

    /// Asks the server for the posts matching `query` once the typing pauses (decision 0079); a newer search
    /// cancels the older one's answer. An empty field asks for the plain list again.
    func search() async {
        guard loaded, reads, !busy, sent != shown else { return }
        let query = sent
        searching = true
        problem = nil
        if query != nil {
            // Searching from the first key, so "none found" waits for the answer rather than flashing.
            do { try await sleep(.milliseconds(300)) } catch {
                searching = false
                return
            }
        }
        do {
            try await page(before: nil, query)
            failed = nil
        } catch {
            failed = { await self.search() }
            problem = Problem(error)
        }
        searching = false
    }

    /// One page of the posts: the first replaces what was shown, a later one adds to it. `query` filters them on
    /// the server, and a page answering a search that has moved on since is dropped.
    private func page(before: String?, _ query: String?) async throws {
        let social = social
        let id = communityId
        let page = try await offMain {
            try social.communityPosts(id, before: before, limit: Self.page, query: query)
        }
        guard query == sent else { return }
        if before == nil {
            posts = page.posts
        } else {
            let listed = Set(posts.map(\.postId))
            posts += page.posts.filter { !listed.contains($0.postId) }
        }
        next = page.next
        shown = query
    }

    /// Joins an open community at once, or asks a private one's moderators to let this account in.
    func join() async {
        await change(again: { await self.join() }) { try $0.joinCommunity($1) }
    }

    func leave() async {
        await change(again: { await self.leave() }) { try $0.leaveCommunity($1) }
    }

    /// Takes back the request to join that waits; then the community as it is now.
    func withdraw() async {
        await change(again: { await self.withdraw() }) { try $0.withdrawJoinRequest($1) }
    }

    /// Joins, leaves or withdraws; then the community, its posts and its member list as they now are. A member
    /// list the server refuses this account (a private community it is not in) is left empty, not shown as a failure.
    private func change(again: @escaping () async -> Void, _ act: @escaping @Sendable (Social, String) throws -> Void)
        async
    {
        let social = social
        let id = communityId
        await perform(again: again) {
            let community = try await offMain { () -> Community in
                try act(social, id)
                return try social.community(id)
            }
            self.community = community
            try await self.first()
            self.members = self.reads ? ((try? await offMain { try social.communityMembers(id) }) ?? []) : []
            self.membersLoaded = !self.members.isEmpty
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

    /// Lets the community's members write anonymous posts, or stops them (decision 0091). The owner alone decides.
    func setAnonymous(_ on: Bool) async {
        guard owns else { return }
        let social = social
        let id = communityId
        await perform(again: { await self.setAnonymous(on) }) {
            self.community = try await offMain { try social.setAnonymousPosts(id, on: on) }
        }
    }

    /// Renames the community, changes its description or makes an open one private; its owner alone may, and a
    /// private one never becomes open again (decisions 0063, 0079). False when a field is empty or too long.
    @discardableResult
    func update(name: String, description: String, audience: CommunityAudience) async -> Bool {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let description = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard owns, let community, !name.isEmpty, name.count <= communityNameLimit,
            description.count <= communityDescriptionLimit
        else { return false }
        let social = social
        let id = communityId
        var saved = false
        await perform(again: { _ = await self.update(name: name, description: description, audience: audience) }) {
            self.community = try await offMain {
                try social.updateCommunity(
                    id, name: name, description: description,
                    audience: audience == community.audience ? nil : audience)
            }
            saved = true
        }
        return saved
    }

    /// Sets the community's picture from the file `make` gives, or its cover (decisions 0080, 0086): a master, the
    /// pick as it was chosen, at most 2400 pixels; then `framing`, which the person made in the crop sheet. The
    /// file is deleted once the core has sent it, or failed to. Only the owner does either. Trying again makes the
    /// file again from the pick.
    func setPicture(_ make: @escaping @Sendable () async throws -> URL, framing: Framing? = nil) async {
        await setImage(cover: false, make, framing)
    }

    func setCover(_ make: @escaping @Sendable () async throws -> URL, framing: Framing? = nil) async {
        await setImage(cover: true, make, framing)
    }

    private func setImage(cover: Bool, _ make: @escaping @Sendable () async throws -> URL, _ framing: Framing?) async {
        guard owns else { return }
        let social = social
        let id = communityId
        await perform(again: { await self.setImage(cover: cover, make, framing) }) {
            let file = try await make()
            defer { try? FileManager.default.removeItem(at: file) }
            self.community = try await offMain {
                if cover {
                    _ = try social.setCommunityCover(id, path: file.path)
                    if let framing { _ = try social.setCommunityCoverFraming(id, framing) }
                } else {
                    _ = try social.setCommunityAvatar(id, path: file.path)
                    if let framing { _ = try social.setCommunityPictureFraming(id, framing) }
                }
                return try social.community(id)
            }
        }
    }

    /// How the picture or the cover is framed now, for the crop sheet to open at.
    func framing(cover: Bool) -> Framing? { cover ? community?.coverFrames : community?.photoFrames }

    /// The master of the picture or cover, in a new temporary file, for the crop sheet to frame again (decision
    /// 0086); nil, with the problem `.noMaster`, for one set before masters were kept. The caller deletes it.
    func master(cover: Bool) async -> URL? {
        guard owns, !busy else { return nil }
        let social = social
        let id = communityId
        var file: URL?
        await perform(again: { _ = await self.master(cover: cover) }) {
            let path = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".webp")
            let found = try await offMain {
                cover
                    ? try social.communityCoverSource(id, path: path.path)
                    : try social.communityPictureSource(id, path: path.path)
            }
            guard found else { throw CoreError.NoMaster }
            file = path
        }
        return file
    }

    /// Frames the picture or the cover again from its master, with no new upload (decision 0086).
    func reframe(cover: Bool, _ framing: Framing) async {
        guard owns else { return }
        let social = social
        let id = communityId
        await perform(again: { await self.reframe(cover: cover, framing) }) {
            self.community = try await offMain {
                if cover {
                    _ = try social.setCommunityCoverFraming(id, framing)
                } else {
                    _ = try social.setCommunityPictureFraming(id, framing)
                }
                return try social.community(id)
            }
        }
    }

    /// Takes the community's picture or its cover away.
    func removePicture() async { await removeImage(cover: false) }

    func removeCover() async { await removeImage(cover: true) }

    private func removeImage(cover: Bool) async {
        guard owns else { return }
        let social = social
        let id = communityId
        await perform(again: { await self.removeImage(cover: cover) }) {
            self.community = try await offMain {
                if cover { try social.removeCommunityCover(id) } else { try social.removeCommunityAvatar(id) }
                return try social.community(id)
            }
        }
    }

    /// The member list, its owner and moderators first, for `community_info` and `Meðlimir og hlutverk`
    /// (decision 0079). Asked for once; a second ask waits for the first.
    func loadMembers() async {
        guard !membersLoaded, !loadingMembers, !busy else { return }
        let social = social
        let id = communityId
        loadingMembers = true
        problem = nil
        do {
            members = try await offMain { try social.communityMembers(id) }
            failed = nil
            membersLoaded = true
        } catch {
            failed = { await self.loadMembers() }
            problem = Problem(error)
        }
        loadingMembers = false
    }

    /// Makes a member a moderator, or a moderator a member again; the owner alone may (decisions 0063, 0079).
    /// The list shows the new role at once, once the server has taken it.
    func setRole(_ account: String, _ role: CommunityRole) async {
        guard owns, members.contains(where: { $0.accountId == account && $0.role != role }) else { return }
        let social = social
        let id = communityId
        await perform(again: { await self.setRole(account, role) }) {
            try await offMain { try social.setCommunityRole(id, account: account, role: role) }
            self.members = self.members.map { member in
                var member = member
                if member.accountId == account { member.role = role }
                return member
            }
        }
    }

    /// The moderation log's newest page, newest first, for `Aðgerðaskrá` (decision 0079). It is a reading of the
    /// log: nothing here edits or deletes an entry.
    func loadLog() async {
        guard !logLoaded, !loadingLog else { return }
        await logPage(before: nil)
    }

    /// The log's next, older page, if there is one and none is on its way.
    func moreLog() async {
        guard let before = logNext, !loadingLog else { return }
        await logPage(before: before)
    }

    /// One page of the log: the first replaces what was shown, a later one adds to it.
    private func logPage(before: String?) async {
        let social = social
        let id = communityId
        loadingLog = true
        problem = nil
        do {
            let page = try await offMain {
                try social.communityModerationLog(id, before: before, limit: Self.logSize)
            }
            if before == nil {
                log = page.entries
            } else {
                let shown = Set(log.map(\.entryId))
                log += page.entries.filter { !shown.contains($0.entryId) }
            }
            logNext = page.next
            failed = nil
            logLoaded = true
        } catch {
            failed = { await self.logPage(before: before) }
            problem = Problem(error)
        }
        loadingLog = false
    }

    /// The gallery's newest page, for `Myndir`; asked for once.
    func loadGallery() async {
        guard !galleryLoaded, !loadingGallery, reads else { return }
        await galleryPage(cursor: nil)
    }

    /// The gallery's next, older page, if there is one and none is on its way.
    func moreGallery() async {
        guard let cursor = galleryNext, !loadingGallery else { return }
        await galleryPage(cursor: cursor)
    }

    private func galleryPage(cursor: String?) async {
        let social = social
        let id = communityId
        loadingGallery = true
        problem = nil
        do {
            let page = try await offMain {
                try social.communityImages(id, cursor: cursor, limit: Self.galleryPage)
            }
            if cursor == nil {
                gallery = page.images
            } else {
                let shown = Set(gallery.map(\.mediaId))
                gallery += page.images.filter { !shown.contains($0.mediaId) }
            }
            galleryNext = page.next
            failed = nil
            galleryLoaded = true
        } catch {
            failed = { await self.galleryPage(cursor: cursor) }
            problem = Problem(error)
        }
        loadingGallery = false
    }

    /// Reads a picked image into a local copy, or says why it is not taken: over 10 MB (by what the picker says
    /// first, then by the copy's size) or unreadable. Posts and comments take their images through this one door.
    nonisolated static func readImage(_ picked: Picked) async -> Result<URL, ImageNotice> {
        if (picked.size ?? 0) > imageLimit { return .failure(.tooLarge) }
        do {
            let file = try await picked.read()
            let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?
                .int64Value
            if (size ?? 0) > imageLimit {
                try? FileManager.default.removeItem(at: file)
                return .failure(.tooLarge)
            }
            return .success(file)
        } catch {
            return .failure(.invalid)
        }
    }

    /// Uploads each picked image not yet uploaded, then publishes the draft with them at the top of the posts;
    /// the box empties. An image the server refuses is named, and nothing is posted. True once it is posted, so
    /// the composer that opened for it closes (decision 0079).
    @discardableResult
    func publish() async -> Bool {
        guard sendable, !busy else { return false }
        let social = social
        let id = communityId
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        var posted = false
        busy = true
        problem = nil
        attachments.imageNotice = nil
        do {
            let media = try await attachments.mediaIds { path in
                try await offMain { try social.uploadPostImage(id, path: path).mediaId }
            }
            let poll = pollFields.map { $0.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) } }
            let secret = anonymous && allowsAnonymous
            let post = try await offMain {
                try social.createPost(id, body: body, media: media, anonymous: secret, poll: poll)
            }
            attachments.finish()
            posts.insert(post, at: 0)
            draft = ""
            anonymous = false
            failed = nil
            posted = true
        } catch {
            if case CoreError.Refused(_, "invalid_media", _) = error { attachments.forgetUploads() }
            if let notice = Self.notice(for: error) {
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

    /// What the server's refusal of an image says, or nil when it is not about an image.
    nonisolated static func notice(for error: Error) -> ImageNotice? {
        switch error {
        case CoreError.Refused(_, "too_large", _): .tooLarge
        case CoreError.Refused(_, "invalid_image", _): .invalid
        default: nil
        }
    }

    /// The posts a moderator featured, at most three, newest pin first (decision 0088). The feed stays
    /// chronological; these are shown beside it, and on an expanded window the feed leaves them out (decision 0092).
    var featured: [Post] { community?.featured ?? [] }

    /// The posts the Umræða feed draws (decision 0092). With the featured posts in the aside they are left out by
    /// the community's `featured` list, not by `Post.pinned`, so a released post is back as soon as the list
    /// changes; the strip layouts and a typed search keep the feed complete.
    func feedPosts(aside: Bool) -> [Post] {
        guard aside, !searched else { return posts }
        let held = Set(featured.map(\.postId))
        return posts.filter { !held.contains($0.postId) }
    }

    /// Features a post or lets it go, for a moderator or the owner (decision 0088): the community is read
    /// again for its featured list, and the posts for the marks. A fourth is refused with `.pinFull`.
    func pin(_ postId: String, _ pinned: Bool) async {
        guard moderates else { return }
        let social = social
        let id = communityId
        await perform(again: { await self.pin(postId, pinned) }) {
            self.community = try await offMain { () -> Community in
                if pinned { try social.pinPost(id, post: postId) } else { try social.unpinPost(id, post: postId) }
                return try social.community(id)
            }
            try await self.page(before: nil, self.sent)
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

    /// This account may close the poll on `post`: its author, the owner or a moderator, while it is open.
    func canClose(_ post: Post) -> Bool {
        guard let poll = post.poll, !poll.closed else { return false }
        return post.mine || moderates
    }

    /// Votes for `option` in the poll on a post, or changes the vote (decision 0090); the post then reads as the
    /// server sent it back. A poll closed meanwhile shows its results and says so.
    func vote(_ postId: String, option: String) async {
        let social = social
        await pollAction(postId) { try social.votePoll(postId, option: option) }
    }

    /// Takes this account's vote back.
    func withdrawVote(_ postId: String) async {
        let social = social
        await pollAction(postId) { try social.withdrawVote(postId) }
    }

    /// Closes the poll: no more votes, and everyone sees the results.
    func closePoll(_ postId: String) async {
        let social = social
        await pollAction(postId) { try social.closePoll(postId) }
    }

    private func pollAction(_ postId: String, _ act: @escaping @Sendable () throws -> Post) async {
        guard writes, !voting.contains(postId) else { return }
        voting.insert(postId)
        problem = nil
        let outcome = await runPollAction(social, postId: postId, act)
        if let post = outcome.post { replace(post) }
        failed = nil
        problem = outcome.problem
        voting.remove(postId)
    }

    private func replace(_ post: Post) {
        if let index = posts.firstIndex(where: { $0.postId == post.postId }) { posts[index] = post }
    }

    /// The newest page again, once a post opened from here is closed: the posts on it take their reactions and
    /// comment counts as they are now, and any newer post goes on top. Quiet: a failure leaves what is shown.
    func refresh() async {
        guard loaded, reads, !busy, !paging, !searching, sent == shown else { return }
        let social = social
        let id = communityId
        let query = sent
        guard
            let page = try? await offMain({
                try social.communityPosts(id, before: nil, limit: Self.page, query: query)
            }), query == sent
        else { return }
        let fresh = Dictionary(page.posts.map { ($0.postId, $0) }, uniquingKeysWith: { first, _ in first })
        let listed = Set(posts.map(\.postId))
        // A post shown in the span the newest page covers but missing from it was deleted since, as one deleted
        // from its own screen is; the whole list when that page is the last.
        let oldest = page.next == nil ? 0 : (page.posts.last?.createdAt ?? UInt64.max)
        let kept = posts.filter { fresh[$0.postId] != nil || $0.createdAt <= oldest }
        posts = page.posts.filter { !listed.contains($0.postId) } + kept.map { fresh[$0.postId] ?? $0 }
    }

    /// The longest post the server takes.
    nonisolated static let postLimit = 5_000

    /// The most images one post holds (decision 0065).
    nonisolated static let imageCount = 4

    /// The largest image the server takes for a post, 10 MB.
    nonisolated static let imageLimit: Int64 = 10 * 1_024 * 1_024

    /// The newest page of posts, when this account may read them; none otherwise. The search starts over, so
    /// joining or leaving shows the plain list.
    private func first() async throws {
        query = ""
        guard reads else {
            posts = []
            next = nil
            shown = nil
            return
        }
        try await page(before: nil, nil)
    }

    /// A page of posts: a screenful and some.
    private nonisolated static let page: UInt32 = 20

    /// A page of the gallery: a screenful of thumbnails and some (decision 0089).
    private nonisolated static let galleryPage: UInt32 = 30

    /// A page of the moderation log: a screenful and some (decision 0079).
    private nonisolated static let logSize: UInt32 = 30

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
