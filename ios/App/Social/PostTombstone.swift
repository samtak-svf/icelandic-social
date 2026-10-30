import SpjallCore
import SwiftUI

/// The mark on what a moderator hid or removed, which only moderators still see; nothing on what is shown.
struct StateMark: View {
    let state: ModerationState

    var body: some View {
        switch state {
        case .visible: EmptyView()
        case .hidden: mark("content_hidden")
        case .removed: mark("content_removed")
        case .pending: mark("post_pending")
        }
    }

    private func mark(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(.sans(12.5, black: true))
            .foregroundStyle(BrandTokens.Colors.danger)
    }
}

/// A removed post as a reader who may not read it gets it (0115): no author, no text, no images.
func isPostTombstone(_ post: Post) -> Bool {
    post.state == .removed && post.author == nil && !post.anonymous && post.body.isEmpty && post.images.isEmpty
}

/// What stands in a removed post's place: that a moderator removed it and when. Its author can read why, and a
/// moderator can open the post itself, which the server still gives them.
struct PostTombstone: View {
    let post: Post
    let moderates: Bool

    var body: some View {
        Panel {
            VStack(alignment: .leading, spacing: 6) {
                Text("content_removed").font(.sans(14.5, black: true))
                Text(verbatim: relativeTime(post.createdAt))
                    .font(.sans(12.5))
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                if post.mine { link("statement_open", to: .statements) }
                if moderates { link("post_tombstone_open", to: .post(post.postId)) }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func link(_ key: LocalizedStringKey, to route: SocialRoute) -> some View {
        NavigationLink(value: route) {
            Text(key)
                .font(.sans(14.5, black: true))
                .foregroundStyle(BrandTokens.Colors.primary)
                .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
    }
}
