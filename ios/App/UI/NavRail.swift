import SwiftUI

/// The places as a narrow rail down the leading edge (decision 0087), for the medium and expanded size classes: the
/// same items and the same selection as the `TabBar`, an icon over a small label; the notifications are the bell in
/// each tab's header (decision 0109). One view at both classes, so a window that grows from medium to expanded keeps
/// its rail.
struct NavRail<Tab: Hashable>: View {
    /// The open tab; a tap on it is a reselect, which the owner answers (#356).
    let selection: Tab
    let select: (Tab) -> Void
    let items: [TabBar<Tab>.Item]

    /// The rail's width.
    static var width: CGFloat { 80 }

    var body: some View {
        VStack(spacing: 4) {
            ForEach(items, id: \.tab) { item in
                let selected = item.tab == selection
                Button {
                    select(item.tab)
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: item.systemImage)
                            .font(.system(size: 22))
                            .frame(height: 24)
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
                        in: RoundedRectangle(cornerRadius: BrandTokens.Radius.pane)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: item.label))
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
