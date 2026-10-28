import SwiftUI

/// The notifications bell (decisions 0109, 0111): the count drawn on it, whether the notifications are the screen
/// showing, and what a tap does. The home view sets it on each tab's navigation stack, so every full screen in it, a
/// pushed one too, ends its top bar with the bell. A modal sheet draws none: its content takes `withoutBell()`.
struct Bell {
    /// How many are new, shown on the bell when there are any.
    let count: Int
    let selected: Bool
    let open: () -> Void
}

extension EnvironmentValues {
    /// The bell every full screen's top bar draws at its trailing end; none in a modal sheet or outside the tabs.
    @Entry var bell: Bell? = nil
}

/// The bell at the trailing end of a header: named, its count read out with it, the primary colour while the
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

/// The bell in the navigation bar of a screen pushed from a tab, after that screen's own items (decision 0111).
private struct BellInNavigationBar: ViewModifier {
    @Environment(\.bell) private var bell

    func body(content: Content) -> some View {
        content.toolbar {
            if let bell {
                ToolbarItem(placement: .topBarTrailing) { BellButton(bell: bell) }
            }
        }
    }
}

extension View {
    /// Ends the navigation bar with the bell. Put it after the screen's own `toolbar`, so the bell comes last.
    func bellInNavigationBar() -> some View { modifier(BellInNavigationBar()) }

    /// The content of a modal sheet, which draws no bell (decision 0111): the environment would carry it in.
    func withoutBell() -> some View { environment(\.bell, nil) }
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
