import SpjallCore
import SwiftUI

/// What a post card says about its post above the byline: pinned (decision 0080), and imported from another
/// platform (decisions 0119, 0120).
struct PostMarks: View {
    let post: Post

    var body: some View {
        if post.pinned {
            HStack(spacing: 4) {
                Image(systemName: "pin.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .accessibilityHidden(true)
                Text("post_pinned")
            }
            .font(.sans(12, black: true))
            .foregroundStyle(BrandTokens.Colors.mutedFg)
        }
        if post.imported {
            Text("post_imported")
                .font(.sans(12, black: true))
                .foregroundStyle(BrandTokens.Colors.mutedFg)
        }
    }
}
