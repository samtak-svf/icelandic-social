import SwiftUI

/// A tab's cream band (0053): its name in capitals under the status bar, an optional action, and at the
/// trailing end the notifications bell (0109, 0111) when the stack has one. Every tab shares it, so every tab starts
/// the same way and the bell sits in the same place on each.
struct ScreenHeader<Action: View>: View {
    let title: String
    @ViewBuilder let action: () -> Action

    @Environment(\.bell) private var bell

    var body: some View {
        HStack {
            Text(verbatim: title.capitals)
                .font(TypeStyle.screenTitle)
                .foregroundStyle(BrandTokens.Colors.fg)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            action()
            if let bell { BellButton(bell: bell) }
        }
        // As tall as the list's band with its round button, so the two tabs line up.
        .frame(minHeight: 34)
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .padding(.vertical, 4)
        .background(BrandTokens.Colors.bg.ignoresSafeArea(edges: .top))
    }
}

extension ScreenHeader where Action == EmptyView {
    init(title: String) {
        self.init(title: title) { EmptyView() }
    }
}
