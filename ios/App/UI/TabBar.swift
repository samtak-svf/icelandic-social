import SwiftUI

/// The bar under the two root screens: white, a hairline on top, small
/// capitals, the open tab in the primary colour. Drawn here rather than by
/// TabView, whose look the system sets.
struct TabBar<Tab: Hashable>: View {
    struct Item {
        let tab: Tab
        let label: String
        let systemImage: String
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
                .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
            }
        }
        .background(BrandTokens.Colors.surface.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) {
            Rectangle().fill(BrandTokens.Colors.border).frame(height: 1)
        }
    }
}
