import Foundation
import Observation
import SpjallCore

/// A community's open reports, for its moderators (decision 0063): each with why it was made and what was
/// reported, as a card. The moderator gives a reason, which goes in the log, then hides or removes the post or
/// comment, answering the report, or closes the report without acting.
@MainActor @Observable
final class ReportsModel {
    let communityId: String
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
    private var failed: (() async -> Void)?

    init(social: Social, communityId: String) {
        self.social = social
        self.communityId = communityId
    }

    func load() async {
        await perform(again: { await self.load() }) { try await self.first() }
    }

    /// The queue's next page, if there is one.
    func more() async {
        guard let next else { return }
        let social = social
        let id = communityId
        await perform(again: { await self.more() }) {
            let page = try await offMain { try social.openReports(id, after: next, limit: Self.page) }
            let shown = Set(self.reports.map(\.reportId))
            let added = page.reports.filter { !shown.contains($0.reportId) }
            self.reports += added
            self.next = page.next
            await self.resolve(added)
        }
    }

    /// Hides the reported post or comment, or removes it with `remove`, for `reason`, answering the report.
    func act(_ report: Report, remove: Bool, reason: String) async {
        let reason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let action = moderation(report.target.kind, remove: remove), Self.valid(reason) else { return }
        let social = social
        let id = communityId
        await perform(again: { await self.act(report, remove: remove, reason: reason) }) {
            try await offMain {
                try social.moderate(
                    id, action: action, target: report.target.id, reason: reason, report: report.reportId)
            }
            self.done = true
            try await self.first()
        }
    }

    /// Closes the report without acting on what it reported, for `reason`.
    func dismiss(_ report: Report, reason: String) async {
        let reason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.valid(reason) else { return }
        let social = social
        await perform(again: { await self.dismiss(report, reason: reason) }) {
            try await offMain { try social.closeReport(report.reportId, resolution: reason) }
            self.done = true
            try await self.first()
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
        let page = try await offMain { try social.openReports(id, after: nil, limit: Self.page) }
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
