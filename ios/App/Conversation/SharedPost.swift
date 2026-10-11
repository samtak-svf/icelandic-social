import SpjallCore
import SwiftUI

/// A forward names no original sender, only that it is one (decision 0041).
struct ForwardedMark: View {
    let foreground: Color

    var body: some View {
        Text("forwarded_marker").font(TypeStyle.meta).italic().foregroundStyle(foreground)
    }
}

/// A post shared here under decision 0040. Since 0044 there are no posts: the
/// card shows one fixed line, never asks the server for anything and opens nothing.
struct SharedCard: View {
    let foreground: Color

    var body: some View {
        HStack(spacing: 10) {
            Rectangle().fill(foreground).frame(width: 3).accessibilityHidden(true)
            Text("post_gone").font(TypeStyle.bubble).italic().foregroundStyle(foreground)
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}
