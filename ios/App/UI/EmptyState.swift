import SwiftUI

/// What a list says when it has nothing in it (decision 0043): one icon, one
/// line, and at most one button. The icon is decoration; the line is read.
struct EmptyState: View {
    let systemImage: String
    let text: LocalizedStringKey
    var action: Action?

    /// The one thing the empty list offers to do.
    struct Action {
        let label: LocalizedStringKey
        let perform: () -> Void
    }

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(BrandTokens.Colors.mutedFg)
                .accessibilityHidden(true)
            Text(text)
                .font(.sans(15, relativeTo: .body))
                .foregroundStyle(BrandTokens.Colors.mutedFg)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let action {
                Button(action: action.perform) {
                    Text(action.label)
                        .font(.sans(15, black: true))
                        .foregroundStyle(BrandTokens.Colors.primaryFg)
                        .padding(.horizontal, 20)
                        .frame(minHeight: 44)
                        .background(BrandTokens.Colors.primary, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 28)
        .frame(maxWidth: .infinity)
    }
}
