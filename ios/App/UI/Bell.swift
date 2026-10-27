import SwiftUI

/// The notifications bell (decision 0109): the count drawn on it, whether the notifications are the screen showing,
/// and what a tap does. The home view sets it on each tab's root, so a screen pushed from a tab draws no bell.
struct Bell {
    /// How many are new, shown on the bell when there are any.
    let count: Int
    let selected: Bool
    let open: () -> Void
}

extension EnvironmentValues {
    /// The bell every tab's `ScreenHeader` draws at its trailing end; none outside a tab's root.
    @Entry var bell: Bell? = nil
}

/// The bell at the trailing end of a tab's header: named, its count read out with it, the primary colour while the
/// notifications are showing.
struct BellButton: View {
    let bell: Bell

    var body: some View {
        Button(action: bell.open) {
            Image(systemName: bell.selected ? "bell.fill" : "bell")
                .font(.system(size: 20))
                .frame(width: 44, height: 44)
                .overlay(alignment: .center) {
                    if bell.count > 0 { Badge(count: bell.count) }
                }
                .foregroundStyle(bell.selected ? BrandTokens.Colors.primary : BrandTokens.Colors.fg)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: localized("notifications_title")))
        .accessibilityValue(Text(verbatim: bell.count > 0 ? plural("notifications_unread", bell.count) : ""))
        .accessibilityAddTraits(bell.selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier("bell")
    }
}

/// The count on the bell: up to 99, then "99+".
struct Badge: View {
    let count: Int

    var body: some View {
        Text(verbatim: count > 99 ? "99+" : "\(count)")
            .font(.sansFixed(9.5, black: true))
            .foregroundStyle(BrandTokens.Colors.primaryFg)
            .padding(.horizontal, 4)
            .frame(minWidth: 16, minHeight: 16)
            .background(BrandTokens.Colors.primary, in: Capsule())
            .offset(x: 10, y: -8)
            .accessibilityHidden(true)
    }
}
