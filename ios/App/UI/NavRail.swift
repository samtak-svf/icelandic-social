import SwiftUI

/// The five places as a narrow rail down the leading edge (decision 0087), for the medium and expanded size classes:
/// the same items, the same badges and the same selection as the `TabBar`, an icon over a small label. One view at
/// both classes, so a window that grows from medium to expanded keeps its rail.
struct NavRail<Tab: Hashable>: View {
    @Binding var selection: Tab
    let items: [TabBar<Tab>.Item]

    /// The rail's width.
    static var width: CGFloat { 80 }

    var body: some View {
        VStack(spacing: 4) {
            ForEach(items, id: \.tab) { item in
                let selected = item.tab == selection
                Button {
                    selection = item.tab
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: item.systemImage)
                            .font(.system(size: 22))
                            .frame(height: 24)
                            .overlay(alignment: .topTrailing) {
                                if item.badge > 0 { Badge(count: item.badge) }
                            }
                        Text(verbatim: item.label.capitals)
                            .font(.sans(9.5, black: true, relativeTo: .caption2))
                            .tracking(0.57)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                    }
                    .foregroundStyle(selected ? BrandTokens.Colors.primary : BrandTokens.Colors.mutedFg)
                    .frame(maxWidth: .infinity, minHeight: 60)
                    .background(
                        selected ? BrandTokens.Colors.secondarySubtle : Color.clear,
                        in: RoundedRectangle(cornerRadius: 12)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: item.label))
                .accessibilityValue(Text(verbatim: item.badge > 0 ? plural("notifications_unread", item.badge) : ""))
                .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6)
        .padding(.top, 12)
        .frame(width: Self.width)
        .frame(maxHeight: .infinity)
        .background(BrandTokens.Colors.surface.ignoresSafeArea(edges: .vertical))
        .overlay(alignment: .trailing) {
            Rectangle().fill(BrandTokens.Colors.border).frame(width: 1).ignoresSafeArea(edges: .vertical)
        }
    }
}
