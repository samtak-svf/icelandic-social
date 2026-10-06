import SwiftUI

/// What went wrong, and a way to try again when trying again can help.
struct ProblemCard: View {
    let problem: Problem
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message)
                .foregroundStyle(BrandTokens.Colors.fg)
            // Without an invite, trying again cannot work; a link can.
            if problem != .inviteRequired {
                Button("try_again", action: onRetry)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: 12))
    }

    private var message: LocalizedStringKey {
        switch problem {
        case .unreachable: "error_unreachable"
        case .inviteRequired: "invite_required"
        case .generic: "error_generic"
        }
    }
}
