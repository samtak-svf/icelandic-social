import Foundation
import Observation
import SpjallCore

/// A community's reports, open or closed, for its moderators (decision 0063): each with why it was made and what
/// was reported, as a card. The moderator gives a reason, which goes in the log, then hides, removes or restores
/// the post or comment, mutes, unmutes, bans or unbans its author, or closes an open report without acting. An
/// action on an open report answers it. A mute lasts a day, a week or 30 days. The API says nothing of whether an
/// author is muted or banned, so both ways are offered and the server answers.
@MainActor @Observable
final class ReportsModel {
    let communityId: String
    /// Which reports are shown: those waiting, or those closed.
    private(set) var showing: ReportState = .open
    private(set) var reports: [Report] = []
    /// What each reported post or comment shows, by its id.
    private(set) var cards: [String: Card] = [:]
    /// The cursor of the next page, nil on the last.
    private(set) var next: String?
    private(set) var loaded = false
    /// An action was logged, until the next one starts.
    private(set) var done = false
    private(set) var busy = false
    private(set) var problem: Problem?

    private let social: Social
    private let now: @Sendable () -> UInt64
    private var failed: (() async -> Void)?

    init(social: Social, communityId: String, now: @escaping @Sendable () -> UInt64 = nowMillis) {
        self.social = social
        self.communityId = communityId
        self.now = now
    }

    func load() async {
        await perform(again: { await self.load() }) { try await self.first() }
    }

    /// Shows the reports in `state` instead.
    func show(_ state: ReportState) async {
        guard state != showing, !busy else { return }
        showing = state
        reports = []
        cards = [:]
        next = nil
        loaded = false
        done = false
        await load()
    }

    /// The queue's next page, if there is one.
    func more() async {
        guard let next else { return }
        let social = social
        let id = communityId
        let state = showing
        await perform(again: { await self.more() }) {
            let page = try await offMain { try social.reports(id, state: state, after: next, limit: Self.page) }
            let shown = Set(self.reports.map(\.reportId))
            let added = page.reports.filter { !shown.contains($0.reportId) }
            self.reports += added
            self.next = page.next
            await self.resolve(added)
        }
    }

    /// Does `verb` about `report`, for `reason`: to what it names or to its author, or closes it. An open report
    /// is answered by the action; a closed one is not named, since the server takes only an open one, and is
    /// not closed again. A mute needs its `period`: without one nothing is sent. The queue is then asked for again.
    func act(_ report: Report, _ verb: ModerationVerb, reason: String, period: MutePeriod? = nil) async {
        let reason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.valid(reason), let step = step(report, verb, reason: reason, period: period) else { return }
        await perform(again: { await self.act(report, verb, reason: reason, period: period) }) {
            try await offMain(step)
            self.done = true
            try await self.first()
        }
    }

    /// The call that does `verb` about `report`, or nil when it does not apply to it.
    private func step(_ report: Report, _ verb: ModerationVerb, reason: String, period: MutePeriod?)
        -> (@Sendable () throws -> Void)?
    {
        let social = social
        let id = communityId
        let open = report.state == .open
        if verb == .dismiss {
            guard open else { return nil }
            return { try social.closeReport(report.reportId, resolution: reason) }
        }
        let target = verb.onMember ? member(report) : report.target.id
        guard let action = moderation(report, verb), let target else { return nil }
        // A mute is for a time (decision 0063): it ends that long from now.
        let until = action == .muteMember ? period.map { $0.until(now()) } : nil
        if action == .muteMember && until == nil { return nil }
        let answers = open ? report.reportId : nil
        return {
            try social.moderate(id, action: action, target: target, reason: reason, report: answers, until: until)
        }
    }

    /// A moderator's reason: something written, and not over the limit.
    nonisolated static func valid(_ reason: String) -> Bool {
        let reason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        return !reason.isEmpty && reason.count <= reasonLimit
    }

    /// The longest reason the server takes.
    nonisolated static let reasonLimit = 500

    private func first() async throws {
        let social = social
        let id = communityId
        let state = showing
        let page = try await offMain { try social.reports(id, state: state, after: nil, limit: Self.page) }
        reports = page.reports
        next = page.next
        loaded = true
        await resolve(page.reports)
    }

    /// The cards of the posts and comments `reports` name. Quiet: without them a report still shows its reason.
    private func resolve(_ reports: [Report]) async {
        let refs = reports.compactMap { cardRef($0.target) }.filter { cards[$0.id] == nil }
        guard !refs.isEmpty else { return }
        let social = social
        guard let resolved = try? await offMain({ try social.cards(refs) }) else { return }
        for card in resolved { cards[reference(card).id] = card }
    }

    /// A page of reports.
    private nonisolated static let page: UInt32 = 30

    /// Tries the action that failed again.
    func retry() async {
        await failed?()
    }

    private func perform(again: @escaping () async -> Void, _ action: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        done = false
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
