import SwiftUI

/// The bar under the root screens: white, a hairline on top, small
/// capitals, the open tab in the primary colour. No tab carries a count: the
/// notifications are the bell in each tab's header (decision 0109). Drawn here
/// rather than by TabView, whose look the system sets.
struct TabBar<Tab: Hashable>: View {
    struct Item {
        let tab: Tab
        let label: String
        let systemImage: String
    }

    /// The open tab; a tap on it is a reselect, which the owner answers (#356).
    let selection: Tab
    let select: (Tab) -> Void
    let items: [Item]

    /// The label's type: size, tracking, and how far it may shrink before it would not fit (`minimumScaleFactor`).
    static var labelSize: CGFloat { 9.5 }
    static var labelTracking: CGFloat { 0.57 }
    static var minimumScale: CGFloat { 0.5 }

    /// What each tab gets: an equal share of the bar, as the row's `maxWidth: .infinity` frames split it.
    static func share(of width: CGFloat, count: Int) -> CGFloat { width / CGFloat(max(1, count)) }

    /// The width the label takes drawn in capitals at `scale` times its size (Dynamic Type), tracking included.
    static func labelWidth(_ label: String, scale: CGFloat = 1) -> CGFloat {
        let size = labelSize * scale
        let face = BrandTokens.FontFiles.sans.min {
            abs($0.weight - Font.blackWeight) < abs($1.weight - Font.blackWeight)
        }
        let font = face.flatMap { UIFont(name: $0.name, size: size) } ?? .systemFont(ofSize: size, weight: .black)
        let text = label.capitals as NSString
        return text.size(withAttributes: [.font: font]).width + labelTracking * scale * CGFloat(text.length)
    }

    /// Whether the label fits its tab on a bar `width` wide with `count` tabs: unscaled, or, when `shrinking`, after
    /// the smallest scale the text may take.
    static func fits(_ label: String, barWidth width: CGFloat, count: Int, scale: CGFloat = 1, shrinking: Bool = false)
        -> Bool
    {
        let needed = labelWidth(label, scale: scale) * (shrinking ? minimumScale : 1)
        return needed <= share(of: width, count: count)
    }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(items, id: \.tab) { item in
                let selected = item.tab == selection
                Button {
                    select(item.tab)
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: item.systemImage)
                            .font(.system(size: 20))
                            .frame(height: 22)
                        // One line always: at a large text size the name gets smaller, never breaks inside the word.
                        Text(verbatim: item.label.capitals)
                            .font(.sans(Self.labelSize, black: true, relativeTo: .caption2))
                            .tracking(Self.labelTracking)
                            .lineLimit(1)
                            .minimumScaleFactor(Self.minimumScale)
                    }
                    .foregroundStyle(selected ? BrandTokens.Colors.primary : BrandTokens.Colors.mutedFg)
                    .padding(.top, 10)
                    .padding(.bottom, 8)
                    .frame(maxWidth: .infinity, minHeight: 56)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: item.label))
                .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
            }
        }
        .background(BrandTokens.Colors.surface.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) {
            Rectangle().fill(BrandTokens.Colors.border).frame(height: 1)
        }
    }
}
