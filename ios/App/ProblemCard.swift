import SwiftUI

/// What went wrong, and a way to try again when trying again can help.
struct ProblemCard: View {
    let problem: Problem
    let onRetry: () -> Void

    /// The standing suspension, for the date a `suspended` refusal names.
    @Environment(\.suspension) private var suspension

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: message)
                .foregroundStyle(BrandTokens.Colors.fg)
            // A refusal names the server's request id (decision 0037), selectable so a tester can quote it.
            if let line = Self.requestIdLine(problem) {
                Text(line)
                    .font(.footnote)
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .textSelection(.enabled)
            }
            // A failure no server answered names the core's code for it (decision 0049).
            if let line = Self.codeLine(problem) {
                Text(line)
                    .font(.footnote)
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .textSelection(.enabled)
            }
            if problem.canRetry {
                Button("try_again", action: onRetry)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: 12))
    }

    /// The line naming the request id, or nil when no server refused the request.
    static func requestIdLine(_ problem: Problem) -> String? {
        problem.requestId.map { localized("problem_request_id", $0) }
    }

    /// The line naming the core's code, or nil when the failure has none.
    static func codeLine(_ problem: Problem) -> String? {
        problem.code.map { localized("problem_local_code", $0) }
    }

    private var message: String {
        if case .suspended = problem { return suspendedProblemText(suspension) }
        return localized(Self.messageKey(problem))
    }

    /// The brand strings key that words `problem`.
    nonisolated static func messageKey(_ problem: Problem) -> String {
        switch problem {
        case .unreachable: "error_unreachable"
        case .identityTaken: "identity_taken"
        case .tooLarge: "media_too_large"
        case .notPermitted: "problem_not_permitted"
        case .notFound: "problem_not_found"
        case .joinDeclined: "problem_join_declined"
        case .noMaster: "image_frames_no_master"
        case .pinFull: "post_pin_full"
        case .anonymousOff: "problem_anonymous_off"
        case .pollClosed: "poll_closed_problem"
        case .suspended: "problem_suspended"
        case .groupPhotoUnsupported: "group_photo_unsupported"
        case .groupPhotoFailed: "group_photo_failed"
        case .generic: "error_generic"
        }
    }
}
