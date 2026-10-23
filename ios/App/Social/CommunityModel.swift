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
    private let sleep: @Sendable (Duration) async throws -> Void
    private var failed: (() async -> Void)?
    /// The posts whose reaction is on its way, so a second tap waits for the first.
    private var reacting: Set<String> = []
    /// The media id of each picked image already uploaded, by its local copy, so a retry does not send it again.
    private var uploaded: [String: String] = [:]
    private var loadingMembers = false

    /// Why an image did not go with the post.
    enum ImageNotice: Equatable, Sendable {
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

    /// The work waiting for this account here, which `Stjórna` counts in its label (decision 0079).
    var manageCount: Int { openReports + pendingRequests }

    /// A search is typed, so the list shows what it found and an empty one says none was.
    var searched: Bool { sent != nil }

    /// The query the posts on screen answer: nil for the plain list. A search for the same words asks for nothing.
    private var shown: String?

    /// The words the server is asked to match: none for an empty field, which is the plain list.
    private var sent: String? {
        let query = query.trimmingCharacters(in: .whitespaces)
        return query.isEmpty ? nil : query
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

    /// Sets the community's picture from the file `make` gives, already small and square, or its cover from one
    /// already cut into a band (decision 0080); the file is deleted once the core has sent it, or failed to.
    /// Only the owner does either. Trying again makes the file again from the pick.
    func setPicture(_ make: @escaping @Sendable () async throws -> URL) async {
        await setImage(cover: false, make)
    }

    func setCover(_ make: @escaping @Sendable () async throws -> URL) async {
        await setImage(cover: true, make)
    }

    private func setImage(cover: Bool, _ make: @escaping @Sendable () async throws -> URL) async {
        guard owns else { return }
        let social = social
        let id = communityId
        await perform(again: { await self.setImage(cover: cover, make) }) {
            let file = try await make()
            defer { try? FileManager.default.removeItem(at: file) }
            self.community = try await offMain {
                if cover {
                    _ = try social.setCommunityCover(id, path: file.path)
                } else {
                    _ = try social.setCommunityAvatar(id, path: file.path)
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

    /// The member list, its owner and moderators first, for `Um samfélagið` and `Meðlimir og hlutverk`
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
    /// the box empties. An image the server refuses is named, and nothing is posted. True once it is posted, so
    /// the composer that opened for it closes (decision 0079).
    @discardableResult
    func publish() async -> Bool {
        guard sendable, !busy else { return false }
        let social = social
        let id = communityId
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let picked = images
        var posted = false
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
            posted = true
        } catch {
            // A media id the server no longer knows (over a day old): the next try uploads again.
            if case CoreError.Refused(_, "invalid_media", _) = error { uploaded = [:] }
            if let notice = Self.notice(for: error) {
                failed = nil
                imageNotice = notice
            } else {
                failed = { _ = await self.publish() }
                problem = Problem(error)
            }
        }
        busy = false
        return posted
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
