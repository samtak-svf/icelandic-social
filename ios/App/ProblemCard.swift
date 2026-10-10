import SwiftUI

/// What went wrong, and a way to try again when trying again can help.
struct ProblemCard: View {
    let problem: Problem
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message)
                .foregroundStyle(BrandTokens.Colors.fg)
            // A refusal names the server's request id (decision 0037), selectable so a tester can quote it.
            if let line = Self.requestIdLine(problem) {
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

    private var message: LocalizedStringKey {
        switch problem {
        case .unreachable: "error_unreachable"
        case .identityTaken: "identity_taken"
        case .tooLarge: "media_too_large"
        case .generic: "error_generic"
        }
    }
}
