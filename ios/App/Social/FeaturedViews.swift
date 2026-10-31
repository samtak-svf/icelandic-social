import SpjallCore
import SwiftUI

/// The featured posts of a community (decision 0088), at most three: a strip of cards that scrolls sideways above the
/// feed on a compact or medium window, and a list in the aside on an expanded one. A card shows the post's first
/// image, or its author's picture when it has none, three lines of its text and who wrote it; a tap opens the post.
struct FeaturedStrip: View {
    let posts: [Post]

    var body: some View {
        if !posts.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                FeaturedTitle()
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 10) {
                        ForEach(posts, id: \.postId) { post in
                            FeaturedCard(post: post).frame(width: Self.cardWidth)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    /// How wide one card is in the strip.
    private static let cardWidth: CGFloat = 288
}

/// The same cards stacked under the heading, for the aside.
struct FeaturedList: View {
    let posts: [Post]

    var body: some View {
        if !posts.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                FeaturedTitle()
                ForEach(posts, id: \.postId) { post in
                    FeaturedCard(post: post)
                }
            }
        }
    }
}

private struct FeaturedTitle: View {
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "pin.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text("community_featured")
        }
        .font(.sans(13, black: true))
        .foregroundStyle(BrandTokens.Colors.mutedFg)
        .accessibilityAddTraits(.isHeader)
    }
}

struct FeaturedCard: View {
    let post: Post

    @Environment(\.postImages) private var images
    @Environment(\.displayScale) private var scale
    @State private var thumb: Image?

    var body: some View {
        NavigationLink(value: SocialRoute.post(post.postId)) {
            Panel {
                HStack(alignment: .top, spacing: 10) {
                    leading
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: summary)
                            .font(.sans(13.5))
                            .foregroundStyle(BrandTokens.Colors.fg)
                            .lineLimit(Self.lines)
                            .multilineTextAlignment(.leading)
                        Text(verbatim: anonymousByline(post) ?? authorName(post.author))
                            .font(TypeStyle.meta)
                            .foregroundStyle(BrandTokens.Colors.mutedFg)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(10)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// The text, or a stand-in for a post that is only pictures.
    private var summary: String {
        post.body.isEmpty ? localized("post_image_alt") : post.body
    }

    @ViewBuilder private var leading: some View {
        if let image = post.images.first {
            Color.clear
                .frame(width: Self.side, height: Self.side)
                .background(BrandTokens.Colors.muted)
                .overlay {
                    if let thumb { thumb.resizable().scaledToFill() }
                }
                .clipShape(RoundedRectangle(cornerRadius: BrandTokens.Radius.thumbnail))
                .accessibilityHidden(true)
                .task(id: image.mediaId) {
                    guard thumb == nil, let images else { return }
                    thumb = await images.load(post.postId, image.mediaId, side: Int(Self.side * scale))
                }
        } else {
            Avatar(
                name: post.author?.name, kind: post.author?.verified == true ? .verified : .unverified,
                size: Self.side, photo: post.author?.photoOf)
        }
    }

    private static let side: CGFloat = 56
    private static let lines = 3
}
