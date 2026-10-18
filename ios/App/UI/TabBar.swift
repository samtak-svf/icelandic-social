import SwiftUI

/// The bar under the root screens: white, a hairline on top, small
/// capitals, the open tab in the primary colour, and a count on a tab that
/// has one. Drawn here rather than by TabView, whose look the system sets.
struct TabBar<Tab: Hashable>: View {
    struct Item {
        let tab: Tab
        let label: String
        let systemImage: String
        /// How many are unread there, shown on the icon when there are any.
        var badge = 0
    }

    @Binding var selection: Tab
    let items: [Item]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(items, id: \.tab) { item in
                let selected = item.tab == selection
                Button {
                    selection = item.tab
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: item.systemImage)
                            .font(.system(size: 20))
                            .frame(height: 22)
                            .overlay(alignment: .topTrailing) {
                                if item.badge > 0 { Badge(count: item.badge) }
                            }
                        Text(verbatim: item.label.capitals)
                            .font(.sans(9.5, black: true, relativeTo: .caption2))
                            .tracking(0.57)
                    }
                    .foregroundStyle(selected ? BrandTokens.Colors.primary : BrandTokens.Colors.mutedFg)
                    .padding(.top, 10)
                    .padding(.bottom, 8)
                    .frame(maxWidth: .infinity, minHeight: 56)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: item.label))
                .accessibilityValue(Text(verbatim: item.badge > 0 ? plural("notifications_unread", item.badge) : ""))
                .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
            }
        }
        .background(BrandTokens.Colors.surface.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) {
            Rectangle().fill(BrandTokens.Colors.border).frame(height: 1)
        }
    }
}

/// The count on a tab's icon: up to 99, then "99+".
private struct Badge: View {
    let count: Int

    var body: some View {
        Text(verbatim: count > 99 ? "99+" : "\(count)")
            .font(.sansFixed(9.5, black: true))
            .foregroundStyle(BrandTokens.Colors.primaryFg)
            .padding(.horizontal, 4)
            .frame(minWidth: 16, minHeight: 16)
            .background(BrandTokens.Colors.primary, in: Capsule())
            .offset(x: 10, y: -6)
            .accessibilityHidden(true)
    }
}
