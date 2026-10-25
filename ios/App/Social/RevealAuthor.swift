import SpjallCore
import SwiftUI

/// `Sýna höfund` (decision 0091): the pill that asks who wrote an anonymous post, behind the confirmation that the
/// community's moderation log records the asking. Shared by the anonymous queue and the report queue.
struct RevealAuthorButton: View {
    let onConfirm: () -> Void
    @State private var asking = false

    var body: some View {
        Button {
            asking = true
        } label: {
            PillLabel(text: "anonymous_reveal", filled: false, wide: false)
        }
        .buttonStyle(.plain)
        .alert(Text("anonymous_reveal_confirm"), isPresented: $asking) {
            Button("anonymous_reveal") { onConfirm() }
            Button("cancel", role: .cancel) {}
        }
    }
}

/// The name a moderator asked for, on the card of the post it belongs to.
struct RevealedAuthorLine: View {
    let author: Author

    var body: some View {
        Text(verbatim: localized("anonymous_revealed", author.name ?? ""))
            .font(.sans(13))
            .fontWeight(.semibold)
            .foregroundStyle(BrandTokens.Colors.fg)
    }
}
