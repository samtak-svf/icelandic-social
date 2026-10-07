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

    nonisolated static let page: UInt32 = 50
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
    private(set) var problem: Problem?

    @ObservationIgnored private let account: Account
    @ObservationIgnored private let live: Live
    @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void
    @ObservationIgnored private let now: @Sendable () -> UInt64
    @ObservationIgnored private var failed: (() async -> Void)?
    @ObservationIgnored private var reading = false
    @ObservationIgnored private var readAgain = false
    @ObservationIgnored private var loadingOlder = false
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
        mode = .reply(item)
    }

    func edit(_ item: Item) {
        guard case .text(let text, _) = item.content else { return }
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
        } catch {
            failed = { await self.load() }
            problem = Problem(error)
            loaded = true
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
