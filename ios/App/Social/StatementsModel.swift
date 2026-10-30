import Foundation
import Observation
import SpjallCore

/// What moderators did to this account's content and why (decisions 0063, 0115), newest first. A decision can be
/// reviewed once; the list is asked for again after asking.
@MainActor @Observable
final class StatementsModel {
    private(set) var statements: [ModerationStatement] = []
    private(set) var next: String?
    private(set) var loaded = false
    /// A call is on its way, so a second tap waits for the first.
    private(set) var busy = false
    private(set) var problem: Problem?

    private nonisolated static let page: UInt32 = 30
    private let social: Social
    private var failed: (() async -> Void)?

    init(social: Social) {
        self.social = social
    }

    func load() async {
        await refresh(again: { await self.load() }) {}
    }

    /// Asks for the one review of the decision.
    func ask(_ entryId: UInt64) async {
        let social = social
        await refresh(again: { await self.ask(entryId) }) { try social.askModerationReview(entryId: entryId) }
    }

    /// Reads the next page, when there is one.
    func more() async {
        guard let cursor = next, !busy else { return }
        let social = social
        busy = true
        problem = nil
        do {
            let page = try await offMain { try social.moderationStatements(before: cursor, limit: Self.page) }
            statements += page.statements
            next = page.next
            failed = nil
        } catch {
            failed = { await self.more() }
            problem = Problem(error)
        }
        busy = false
    }

    /// Tries the action that failed again.
    func retry() async {
        await failed?()
    }

    /// Runs `action`, then asks for the list again from its start.
    private func refresh(again: @escaping () async -> Void, _ action: @escaping @Sendable () throws -> Void) async {
        guard !busy else { return }
        let social = social
        busy = true
        problem = nil
        do {
            let page = try await offMain {
                try action()
                return try social.moderationStatements(before: nil, limit: Self.page)
            }
            statements = page.statements
            next = page.next
            failed = nil
        } catch {
            failed = again
            problem = Problem(error)
        }
        loaded = true
        busy = false
    }
}
