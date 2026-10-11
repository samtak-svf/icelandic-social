import SwiftUI

/// What a list says when it has nothing in it (decision 0043): one icon, one
/// line, and at most one button. The icon is decoration; the line is read.
/// The empty conversation list alone also offers `secondary` beside it:
/// inviting is one way in, finding someone already here the other
/// (decisions 0036, 0043).
struct EmptyState: View {
    let systemImage: String
    let text: LocalizedStringKey
    var action: Action?
    var secondary: Action?

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
                // Side by side, and one under the other when a large font leaves no room.
                ViewThatFits {
                    HStack(spacing: 8) { buttons(action) }
                    VStack(spacing: 8) { buttons(action) }
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 28)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder private func buttons(_ action: Action) -> some View {
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
        if let secondary {
            Button(action: secondary.perform) {
                Text(secondary.label)
                    .font(.sans(15, black: true))
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .padding(.horizontal, 20)
                    .frame(minHeight: 44)
                    .overlay(Capsule().stroke(BrandTokens.Colors.border))
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
        }
    }
}
