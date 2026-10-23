import Observation
import SpjallCore
import SwiftUI

/// A forward names no original sender, only that it is one (decision 0041).
struct ForwardedMark: View {
    let foreground: Color

    var body: some View {
        Text("forwarded_marker").font(TypeStyle.meta).italic().foregroundStyle(foreground)
    }
}

/// What a shared post card needs from the communities (decision 0080): the client that resolves it, a way to draw
/// its first image and a way to open the post. Set on the conversations' stack; nil draws the plain line.
struct SharedPosts {
    let social: Social
    let images: PostImages
    let open: @MainActor (String) -> Void
}

private struct SharedPostsKey: EnvironmentKey {
    static var defaultValue: SharedPosts? { nil }
}

extension EnvironmentValues {
    var sharedPosts: SharedPosts? {
        get { self[SharedPostsKey.self] }
        set { self[SharedPostsKey.self] = newValue }
    }
}

/// Resolves one shared post through `cards`, once per card: the server shows only what the post's own access check
/// allows, so a post that is gone or not this account's to see comes back unavailable (decision 0080, #288).
@MainActor @Observable
final class SharedCardModel {
    /// The answer; nil until the server has given one, which a failed read (offline) leaves for the next draw.
    private(set) var card: Card?

    @ObservationIgnored private let social: Social
    @ObservationIgnored private let postId: String
    @ObservationIgnored private var loading = false

    init(social: Social, postId: String) {
        self.social = social
        self.postId = postId
    }

    /// Whether the post is known to be gone.
    var gone: Bool {
        switch card {
        case .unavailable?: true
        case .post?, .comment?, .community?, nil: false
        }
    }

    func load() async {
        guard card == nil, !loading else { return }
        loading = true
        defer { loading = false }
        let social = social
        let reference = CardRef(kind: .post, id: postId)
        guard let found = try? await offMain({ try social.cards([reference]) }) else { return }
        // An empty answer is the same as an unavailable one.
        card = found.first ?? .unavailable(reference: reference)
    }
}

/// A post shared here under decisions 0040 and 0080: the community, the author, the excerpt and the first image
/// as a card; a tap opens the post. A post that is gone keeps one fixed line, and one not read yet the plain
/// "shared post" line.
struct SharedCard: View {
    let postId: String
    let foreground: Color

    @Environment(\.sharedPosts) private var shared
    @State private var model: SharedCardModel?

    var body: some View {
        content
            .task(id: postId) {
                guard let shared else { return }
                let loaded = model ?? SharedCardModel(social: shared.social, postId: postId)
                model = loaded
                await loaded.load()
            }
    }

    @ViewBuilder private var content: some View {
        switch model?.card {
        case .post(_, let community, let author, let excerpt, let image, _)?:
            HStack(spacing: 10) {
                bar
                Button {
                    shared?.open(postId)
                } label: {
                    card(community: community, author: author, excerpt: excerpt, image: image)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(.isLink)
            }
            .foregroundStyle(foreground)
            .fixedSize(horizontal: false, vertical: true)
        case .unavailable?, .comment?, .community?:
            line("post_gone")
        case nil:
            line("post_shared")
        }
    }

    private func card(community: CardCommunity, author: Author, excerpt: String, image: PostImage?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                LoadedPhoto(community.pictureOf) { image in
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 14, height: 14)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                } placeholder: {
                    Image(systemName: "person.3.fill")
                        .font(.system(size: 9, weight: .semibold))
                }
                .frame(width: 14, height: 14)
                .accessibilityHidden(true)
                Text(verbatim: community.name).lineLimit(1)
            }
            .font(TypeStyle.meta)
            Text(verbatim: authorName(author)).font(.sans(13, black: true)).lineLimit(1)
            if !excerpt.isEmpty {
                Text(verbatim: excerpt).font(TypeStyle.bubble).lineLimit(4).multilineTextAlignment(.leading)
            }
            if let image, let shared {
                SharedCardImage(postId: postId, image: image, images: shared.images)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var bar: some View {
        Rectangle().fill(foreground).frame(width: 3).accessibilityHidden(true)
    }

    private func line(_ key: LocalizedStringKey) -> some View {
        HStack(spacing: 10) {
            bar
            Text(key).font(TypeStyle.bubble).italic().foregroundStyle(foreground)
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// The first image of a shared post, cropped to a landscape band.
private struct SharedCardImage: View {
    let postId: String
    let image: PostImage
    let images: PostImages

    @Environment(\.displayScale) private var scale
    @State private var loaded: Image?

    var body: some View {
        Color.clear
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .background(BrandTokens.Colors.muted)
            .overlay {
                if let loaded {
                    loaded.resizable().scaledToFill()
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .accessibilityElement()
            .accessibilityLabel(Text("post_image_alt"))
            .accessibilityAddTraits(.isImage)
            .task(id: image.mediaId) {
                guard loaded == nil else { return }
                loaded = await images.load(postId, image.mediaId, side: Int(480 * scale))
            }
    }
}
