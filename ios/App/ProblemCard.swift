import SwiftUI

/// What went wrong, and a way to try again when trying again can help.
struct ProblemCard: View {
    let problem: Problem
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message)
                .foregroundStyle(BrandTokens.Colors.fg)
            // Trying again cannot free a kennitala another account holds, nor shrink a file.
            if problem != .identityTaken && problem != .tooLarge {
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
        case .identityTaken: "identity_taken"
        case .tooLarge: "media_too_large"
        case .generic: "error_generic"
        }
    }
}
