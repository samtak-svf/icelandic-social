import SpjallCore
import SwiftUI

/// A forward names no original sender, only that it is one (decision 0041).
struct ForwardedMark: View {
    let foreground: Color

    var body: some View {
        Text("forwarded_marker").font(TypeStyle.meta).italic().foregroundStyle(foreground)
    }
}

/// A Fljótið post shared here (decision 0040): its author and text as the
/// server holds them now, fetched while the card is on screen and kept
/// nowhere, labelled as from the feed above its author (decision 0043).
/// Until it comes, and when it cannot, only fixed words. A tap opens
/// its replies once there is a post to open.
struct SharedCard: View {
    let postId: String
    let foreground: Color
    let model: ConversationModel
    var lineLimit: Int?
    var onPost: ((String) -> Void)?

    var body: some View {
        HStack(spacing: 10) {
            Rectangle().fill(foreground).frame(width: 3).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                switch model.posts[postId] {
                case .found(let post):
                    if let onPost {
                        Button {
                            onPost(postId)
                        } label: {
                            found(post)
                        }
                        .buttonStyle(.plain)
                    } else {
                        found(post)
                    }
                case .gone:
                    quiet("post_gone")
                case .failed:
                    quiet("post_load_failed")
                    Button("try_again") { Task { await model.showPost(postId) } }
                case .loading, nil:
                    quiet("post_shared")
                }
            }
            .foregroundStyle(foreground)
        }
        .fixedSize(horizontal: false, vertical: true)
        .task(id: postId) { await model.showPost(postId) }
    }

    private func found(_ post: Post) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            // Not the sender's own words, but a post from the feed (decision 0043).
            Text("post_from_feed").font(TypeStyle.meta)
            HStack(spacing: 4) {
                Text(verbatim: shownName(post.author)).font(.caption.weight(.semibold))
                if post.author.verified { VerifiedMark(size: 13) }
            }
            Text(verbatim: post.body).font(TypeStyle.bubble).lineSpacing(3).lineLimit(lineLimit)
        }
    }

    private func quiet(_ key: LocalizedStringKey) -> some View {
        Text(key).font(TypeStyle.bubble).italic()
    }
}
