import Foundation
import Observation
import SpjallCore

/// One conversation (decision 0022): its timeline as the core folds it, the
/// composer, and the long-press actions. It reads the newest page again on
/// every event for it, marks what is on screen read, sends typing frames, and
/// asks the core to expire items when the first of them is due.
@MainActor @Observable
final class ConversationModel {
    /// What the composer's text does when sent.
    enum Mode: Equatable {
        case new
        case reply(Item)
        case edit(Item)
    }

    /// A photo or file of the timeline, by seq.
    enum Media: Equatable {
        case loading
        case ready(String)
        case failed
    }

    /// A photo or file picked or taken, waiting above the field until it is sent (decision 0048).
    struct Pending: Equatable {
        let path: String
        let mime: String
        let name: String?
        var photo: Bool { mime.hasPrefix("image/") }
    }

    /// A file fetched for opening, its type, and the sender's name for it.
    struct Opened: Equatable {
        let path: String
        let mime: String
        let name: String?
    }

    /// The photos and files the information screen lists, newest first (decision 0055).
    struct Shared {
        var items: [Item] = []
        var loaded = false
        /// There may be older ones than the last here.
        var more = true
    }

    nonisolated static let page: UInt32 = 50
    /// The largest photo or file the core sends (decision 0023), 25 MB.
    nonisolated static let mediaLimit: Int64 = 25 * 1_024 * 1_024
    // The core sends at most one active frame each 3 s while one types.
    nonisolated static let typingIdle: Duration = .seconds(5)
    nonisolated static let typingShown: Duration = .seconds(6)

    let id: String
    private(set) var conversation: Conversation?
    /// Oldest first, the unsent ones last.
    private(set) var items: [Item] = []
    private(set) var loaded = false
    /// There may be items before the first one here.
    private(set) var older = true
    /// The other side is typing.
    private(set) var typing = false
    private(set) var draft = ""
    private(set) var mode = Mode.new
    /// The photo or file waiting to go with the field's text as its caption.
    private(set) var attachment: Pending?

    /// The composer's one action (decision 0043).
    enum ComposerAction: Equatable {
        case attach, send
    }

    /// Attach while a new message's field is empty and nothing waits, send once it has text or a photo or
    /// file waits (decision 0048). Replying or editing never attaches, so send stays there.
    var composerAction: ComposerAction {
        mode == .new && attachment == nil && draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? .attach : .send
    }

    /// There is something for send to send.
    var sendable: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (mode == .new && attachment != nil)
    }

    /// A button beside the composer's field.
    enum ComposerButton: Equatable {
        case camera, attach, send
    }

    /// The camera, where the phone has one, then attach while the field is empty; send alone once it has
    /// text (decision 0047).
    func composerButtons(camera: Bool) -> [ComposerButton] {
        switch composerAction {
        case .attach: camera ? [.camera, .attach] : [.attach]
        case .send: [.send]
        }
    }

    /// Someone else is here and the conversation still takes messages: the composer, the menu and a tap
    /// on the title, which opens the conversation's information (decisions 0043, 0047), all show together.
    /// No one else is here once a block ends a 1:1, so there is nothing to send to.
    var writable: Bool {
        guard let conversation, !conversation.members.isEmpty else { return false }
        switch conversation.state {
        case .active, .new: return true
        case .excluded, .removed, .left, .stale: return false
        }
    }
    private(set) var media: [UInt64: Media] = [:]
    /// The file to open next; `didOpen` clears it.
    private(set) var opened: Opened?
    /// Nil until the information screen asks for them, so the conversation alone never reads them.
    private(set) var shared: Shared?
    private(set) var problem: Problem?

    @ObservationIgnored let account: Account
    @ObservationIgnored let live: Live
    @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void
    @ObservationIgnored private let now: @Sendable () -> UInt64
    @ObservationIgnored private var failed: (() async -> Void)?
    @ObservationIgnored private var reading = false
    @ObservationIgnored private var readAgain = false
    @ObservationIgnored private var loadingOlder = false
    @ObservationIgnored private var loadingShared = false
    @ObservationIgnored private var marked: UInt64?
    @ObservationIgnored private var typingSent = false
    @ObservationIgnored private var typingIdleTask: Task<Void, Never>?
    @ObservationIgnored private var typingShownTask: Task<Void, Never>?
    @ObservationIgnored private var expiry: Task<Void, Never>?

    init(
        id: String,
        account: Account,
        live: Live,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping @Sendable () -> UInt64 = { UInt64(Date().timeIntervalSince1970 * 1_000) }
    ) {
        self.id = id
        self.account = account
        self.live = live
        self.sleep = sleep
        self.now = now
    }

    /// Reads the timeline, then again after each event for it, for as long as the screen shows.
    func follow() async {
        let events = live.events()
        await load()
        for await event in events {
            if case .typing(let conversation, let active) = event {
                if conversation == id { showTyping(active) }
            } else if event.concerns(id) {
                await load()
            }
        }
    }

    /// Reads the newest page. Asked for during a read, it reads once more after it.
    func load() async {
        guard !reading else {
            readAgain = true
            return
        }
        reading = true
        repeat {
            readAgain = false
            await read()
        } while readAgain
        reading = false
    }

    /// The page before the first item here; does nothing while one is read or at the start.
    func loadOlder() async {
        guard let first = items.first?.seq, older, !loadingOlder else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        let (account, id) = (account, id)
        do {
            let page = try await offMain { try account.timeline(id, before: first, limit: Self.page) }
            items = page + items
            older = page.count == Int(Self.page)
        } catch {
            problem = Problem(error)
        }
    }

    func type(_ text: String) {
        draft = text
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { stopTyping() } else { startTyping() }
    }

    func reply(_ item: Item) {
        removeAttachment()
        mode = .reply(item)
    }

    /// The picker that copies `item` into other conversations (decision 0041); nil for what is not forwarded.
    func forwarding(_ item: Item) -> PickModel? {
        guard Offer(item).forward, let seq = item.seq else { return nil }
        let from = id
        return PickModel(
            account: account,
            live: live,
            except: from,
            preview: { _ in Outgoing.message(item) }
        ) { account, to in
            _ = try account.forward(from, seq: seq, to: to)
        }
    }

    func edit(_ item: Item) {
        guard case .text(let text, _) = item.content else { return }
        removeAttachment()
        mode = .edit(item)
        draft = text
    }

    /// Back to a new message; an edit's text goes with it.
    func cancelMode() {
        if case .edit = mode { draft = "" }
        mode = .new
    }

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if mode == .new, let attachment {
            self.attachment = nil
            draft = ""
            stopTyping()
            await sendAttachment(attachment, caption: text.isEmpty ? nil : text)
            return
        }
        let body: Body? =
            switch mode {
            case .new: .text(text: text)
            case .reply(let item): item.envelopeId.map { .reply(to: $0, text: text) }
            case .edit(let item): item.envelopeId.map { .edit(target: $0, text: text) }
            }
        guard !text.isEmpty, let body else { return }
        draft = ""
        mode = .new
        stopTyping()
        await queue(body)
    }

    /// Sends the place the phone found, once the person confirmed it (decision 0059).
    func sendLocation(latitude: Double, longitude: Double, accuracy: Double) async {
        await queue(locationBody(latitude: latitude, longitude: longitude, accuracy: accuracy))
    }

    func delete(_ item: Item) async {
        guard let target = item.envelopeId else { return }
        await queue(.delete(target: target))
    }

    /// Adds the emoji, or takes this account's away when it is there.
    func react(_ item: Item, _ emoji: String) async {
        guard let target = item.envelopeId else { return }
        let remove = item.reactions.contains { $0.emoji == emoji && $0.own }
        await queue(.reaction(target: target, emoji: emoji, remove: remove))
    }

    /// Keeps a photo or file above the field without sending it (decision 0048); one over the limit is
    /// refused before it is read. A second one takes the place of the first.
    func pick(_ picked: Picked) async {
        if (picked.size ?? 0) > Self.mediaLimit {
            problem = .tooLarge
            return
        }
        problem = nil
        do {
            let file = try await picked.read()
            let size = (try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.int64Value
            if (size ?? 0) > Self.mediaLimit {
                try? FileManager.default.removeItem(at: file)
                problem = .tooLarge
                return
            }
            removeAttachment()
            attachment = Pending(path: file.path, mime: picked.mime, name: picked.name)
            failed = nil
        } catch {
            failed = { await self.pick(picked) }
            problem = Problem(error)
        }
    }

    /// Takes the waiting photo or file away; nothing is sent.
    func removeAttachment() {
        guard let attachment else { return }
        self.attachment = nil
        try? FileManager.default.removeItem(atPath: attachment.path)
    }

    /// Sends `pending` with its caption; a failure puts both back to be sent again.
    private func sendAttachment(_ pending: Pending, caption: String?) async {
        problem = nil
        let (account, id) = (account, id)
        do {
            _ = try await offMain {
                try account.sendMedia(id, path: pending.path, mime: pending.mime, caption: caption, name: pending.name)
            }
            // The core copied it into its own folder.
            try? FileManager.default.removeItem(atPath: pending.path)
            failed = nil
            live.sync()
            await load()
        } catch {
            if attachment == nil {
                attachment = pending
            } else {
                try? FileManager.default.removeItem(atPath: pending.path)
            }
            if draft.isEmpty { draft = caption ?? "" }
            failed = { await self.send() }
            problem = Problem(error)
        }
    }

    /// Downloads the photo or file of `item`, once; a failed one can be asked for again.
    func fetch(_ item: Item) async {
        guard let seq = item.seq else { return }
        switch media[seq] {
        case .loading, .ready: return
        case .failed, nil: await download(seq)
        }
    }

    /// The information screen is open: its photos and files are read now and with every read after.
    func loadShared() async {
        if shared == nil { shared = Shared() }
        await load()
    }

    /// The page of photos and files before the last one here.
    func moreShared() async {
        guard let current = shared, current.more, let last = current.items.last?.seq, !loadingShared else { return }
        loadingShared = true
        defer { loadingShared = false }
        let (account, id) = (account, id)
        do {
            let page = try await offMain { try account.shared(id, before: last, limit: Self.page) }
            shared?.items += page
            shared?.more = page.count == Int(Self.page)
        } catch {
            problem = Problem(error)
        }
    }

    /// Fetches the file of `item` into `opened`.
    func open(_ item: Item) async {
        guard let seq = item.seq, case .media(let mime, _, _, let name) = item.content else { return }
        var ready = media[seq]
        if case .ready = ready {} else { ready = await download(seq) }
        if case .ready(let path) = ready { opened = Opened(path: path, mime: mime, name: name) }
    }

    func didOpen() {
        opened = nil
    }

    /// Sets the disappearing timer, or turns it off with nil (decision 0022).
    func timer(_ seconds: UInt32?) async {
        await queue(.disappearing(seconds: seconds))
    }

    /// Mutes the conversation for `duration` (decision 0042): no push and no notice for it, on every device of
    /// the account. A failure is said, so no one believes a mute that did not happen.
    func mute(_ duration: MuteFor) async {
        let account = account
        let id = id
        await change({ await self.mute(duration) }) { _ = try account.mute(id, for: duration) }
    }

    /// Turns the conversation's notifications back on.
    func unmute() async {
        let account = account
        let id = id
        await change({ await self.unmute() }) { try account.unmute(id) }
    }

    private func change(_ again: @escaping () async -> Void, _ call: @escaping @Sendable () throws -> Void) async {
        do {
            try await offMain(call)
            failed = nil
            problem = nil
            await load()
        } catch {
            failed = again
            problem = Problem(error)
        }
    }

    /// Blocks the other person of a 1:1 (decision 0024); the conversation ends.
    func block() async {
        guard conversation?.name == nil, let members = conversation?.members, members.count == 1 else { return }
        let other = members[0].account
        do {
            try await live.performAndWait { try $0.block(other) }
            failed = nil
            problem = nil
            await load()
        } catch {
            // Said, not swallowed: the person must not believe a block that did not happen.
            failed = { await self.block() }
            problem = Problem(error)
        }
    }

    /// Names the group, or clears its name with nil (decision 0078).
    func rename(_ name: String?) async {
        let account = account
        let id = id
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        let next = (trimmed?.isEmpty == false) ? trimmed : nil
        do {
            _ = try await offMain { try account.rename(id, name: next) }
            failed = nil
            problem = nil
            live.sync()
            await load()
        } catch {
            failed = { await self.rename(name) }
            problem = Problem(error)
        }
    }

    /// Sets the group's photo from the file `make` produces, which is deleted after (decision 0094).
    func setGroupPhoto(_ make: @escaping @Sendable () async throws -> URL) async {
        let account = account
        let id = id
        do {
            let file = try await make()
            defer { try? FileManager.default.removeItem(at: file) }
            _ = try await offMain { try account.setGroupPhoto(conversationId: id, path: file.path) }
            failed = nil
            problem = nil
            live.sync()
            await load()
        } catch {
            failed = { await self.setGroupPhoto(make) }
            problem = Problem.groupPhoto(error)
        }
    }

    /// Removes the group's photo (decision 0094).
    func clearGroupPhoto() async {
        let account = account
        let id = id
        do {
            _ = try await offMain { try account.clearGroupPhoto(conversationId: id) }
            failed = nil
            problem = nil
            live.sync()
            await load()
        } catch {
            failed = { await self.clearGroupPhoto() }
            problem = Problem.groupPhoto(error)
        }
    }

    /// Removes `member` from the group (decision 0078).
    func remove(_ member: String) async {
        let account = account
        let id = id
        do {
            try await offMain { try account.removeAccounts(id, accounts: [member]) }
            failed = nil
            problem = nil
            live.sync()
            await load()
        } catch {
            failed = { await self.remove(member) }
            problem = Problem(error)
        }
    }

    /// Leaves the group (decision 0078).
    func leave() async {
        let account = account
        let id = id
        do {
            try await offMain { try account.leave(id) }
            failed = nil
            problem = nil
            live.sync()
            await load()
        } catch {
            failed = { await self.leave() }
            problem = Problem(error)
        }
    }

    /// Sends the failed items again.
    func resend() {
        let id = id
        live.perform { try $0.retry(id) }
    }

    /// Tries the action that failed again, or reads again.
    func retry() async {
        if let failed { await failed() } else { await load() }
    }

    /// The screen went away or to the background: no one is typing here any more.
    func paused() {
        stopTyping()
    }

    private func queue(_ body: Body) async {
        problem = nil
        let (account, id) = (account, id)
        do {
            _ = try await offMain { try account.send(id, body: body) }
            failed = nil
            live.sync()
            await load()
        } catch {
            failed = { await self.queue(body) }
            problem = Problem(error)
        }
    }

    private func read() async {
        let size = max(Self.page, UInt32(items.count))
        let (account, id) = (account, id)
        do {
            let (conversation, items) = try await offMain {
                (try account.conversations().first { $0.id == id }, try account.timeline(id, before: nil, limit: size))
            }
            failed = nil
            self.conversation = conversation
            self.items = items
            older = older && items.count >= Int(size)
            problem = nil
            loaded = true
            await markRead(items)
            scheduleExpiry(items)
            if let current = shared { await readShared(size: max(Self.page, UInt32(current.items.count))) }
        } catch {
            failed = { await self.load() }
            problem = Problem(error)
            loaded = true
        }
    }

    private func readShared(size: UInt32) async {
        let (account, id) = (account, id)
        do {
            let items = try await offMain { try account.shared(id, before: nil, limit: size) }
            shared = Shared(items: items, loaded: true, more: items.count >= Int(size))
        } catch {
            problem = Problem(error)
        }
    }

    /// The newest item is on screen once the timeline is read, so everything up to it is read.
    private func markRead(_ items: [Item]) async {
        guard let newest = items.compactMap(\.seq).max() else { return }
        if let marked, newest <= marked { return }
        let (account, id) = (account, id)
        guard (try? await offMain { try account.markRead(id, seq: newest) }) != nil else { return }
        marked = newest
        live.sync()
    }

    @discardableResult
    private func download(_ seq: UInt64) async -> Media {
        media[seq] = .loading
        let (account, id) = (account, id)
        let result: Media
        do {
            result = .ready(try await offMain { try account.media(id, seq: seq) })
        } catch {
            result = .failed
        }
        media[seq] = result
        return result
    }

    private func scheduleExpiry(_ items: [Item]) {
        expiry?.cancel()
        guard let due = items.compactMap(\.expiresAt).min() else { return }
        let wait = Duration.milliseconds(Int64(due) - Int64(now()))
        expiry = Task { [sleep, live] in
            guard (try? await sleep(max(.zero, wait))) != nil else { return }
            live.perform { try $0.expire() }
        }
    }

    private func showTyping(_ active: Bool) {
        typingShownTask?.cancel()
        typing = active
        // A typing frame that never ends (the other side went away) stops showing.
        guard active else { return }
        typingShownTask = Task { [sleep] in
            guard (try? await sleep(Self.typingShown)) != nil else { return }
            self.typing = false
        }
    }

    private func startTyping() {
        typingIdleTask?.cancel()
        typingIdleTask = Task { [sleep] in
            await typingFrame(true)
            guard (try? await sleep(Self.typingIdle)) != nil else { return }
            stopTyping()
        }
    }

    private func stopTyping() {
        typingIdleTask?.cancel()
        guard typingSent else { return }
        typingSent = false
        Task { await typingFrame(false) }
    }

    private func typingFrame(_ active: Bool) async {
        let (account, id) = (account, id)
        // A typing frame that fails to go is not worth a word.
        guard let frame = (try? await offMain { try account.typing(id, active: active) }) ?? nil else { return }
        live.send(frame)
        if active { typingSent = true }
    }
}

/// A photo or file the person chose, not read yet. `size` and `name` are what
/// the picker says, when it says; `read` copies it to a file the model deletes.
struct Picked: Sendable {
    let mime: String
    let size: Int64?
    let name: String?
    let read: @Sendable () async throws -> URL

    init(mime: String, size: Int64?, name: String? = nil, read: @escaping @Sendable () async throws -> URL) {
        self.mime = mime
        self.size = size
        self.name = name
        self.read = read
    }
}

extension Event {
    /// Whether the timeline of `conversation` may look different after this event.
    func concerns(_ conversation: String) -> Bool {
        switch self {
        case .message(let message): message.conversation == conversation
        case .profiles: true
        case .typing: false
        case .membership(let id, _, _), .joined(let id), .devices(let id, _), .removed(let id), .stale(let id),
            .timeline(let id, _), .expired(let id, _):
            id == conversation
        }
    }
}
