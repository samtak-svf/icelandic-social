import Foundation
import Observation
import SpjallCore

/// Reporting a post, a comment or a community to its moderators (decision 0063): a reason, a note if the
/// person wants, and a thank-you once it is sent. Who reported is never shown to the moderators.
@MainActor @Observable
final class ReportModel {
    let target: ReportTarget
    var reason: ReportReason?
    var note = ""
    private(set) var sent = false
    private(set) var busy = false
    private(set) var problem: Problem?

    private let social: Social

    init(social: Social, target: ReportTarget) {
        self.social = social
        self.target = target
    }

    /// A reason is picked and the note is not over the limit.
    var sendable: Bool {
        reason != nil && note.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count <= Self.noteLimit && !sent
    }

    func send() async {
        guard sendable, !busy, let reason else { return }
        let social = social
        let target = target
        let note = note.trimmingCharacters(in: .whitespacesAndNewlines)
        busy = true
        problem = nil
        do {
            try await offMain { try social.report(target, reason: reason, note: note) }
            sent = true
        } catch {
            problem = Problem(error)
        }
        busy = false
    }

    /// The longest note the server takes, in UTF-16 units as the server counts.
    nonisolated static let noteLimit = 500

    /// A note cut to what the server takes, never through a character.
    nonisolated static func capped(_ text: String) -> String {
        var kept = text
        while kept.utf16.count > noteLimit { kept.removeLast() }
        return kept
    }
}
