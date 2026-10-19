import ImageIO
import SpjallCore
import SwiftUI
import UIKit

/// Where a post's images come from (decision 0065): the path of the WebP the core fetched once and keeps.
struct PostImages: Sendable {
    let social: Social

    /// The image decoded no larger than `side` pixels; nil when it cannot be had now (offline, refused, not an
    /// image), so the next draw asks again.
    func load(_ post: String, _ media: String, side: Int) async -> Image? {
        let social = social
        return try? await offMain {
            try postPhoto(social.postImage(post, media: media), side: side).map { Image(uiImage: $0) }
        }
    }
}

private struct PostImagesKey: EnvironmentKey {
    static let defaultValue: PostImages? = nil
}

extension EnvironmentValues {
    /// Where `PostImageGrid` gets a post's images from; nil draws a plain box in each one's place.
    var postImages: PostImages? {
        get { self[PostImagesKey.self] }
        set { self[PostImagesKey.self] = newValue }
    }
}

/// The image file at `path`, upright and no larger than `side` pixels on its longer edge, or nil when it is not
/// an image.
func postPhoto(_ path: String, side: Int) -> UIImage? {
    guard let source = CGImageSourceCreateWithURL(URL(filePath: path) as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: side,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    return UIImage(cgImage: image)
}

/// A post's images under its text: one at its own shape, within bounds, more two to a row as squares.
struct PostImageGrid: View {
    let post: Post

    var body: some View {
        if let single = post.images.first, post.images.count == 1 {
            let ratio = single.height > 0 ? CGFloat(single.width) / CGFloat(single.height) : 1
            PostImageView(postId: post.postId, image: single, ratio: min(max(ratio, 0.75), 2))
        } else if !post.images.isEmpty {
            let rows = stride(from: 0, to: post.images.count, by: 2).map {
                Array(post.images[$0..<min($0 + 2, post.images.count)])
            }
            VStack(spacing: 6) {
                ForEach(rows, id: \.first?.mediaId) { row in
                    HStack(spacing: 6) {
                        ForEach(row, id: \.mediaId) { image in
                            PostImageView(postId: post.postId, image: image, ratio: 1)
                        }
                        if row.count == 1 { Color.clear.aspectRatio(1, contentMode: .fit) }
                    }
                }
            }
        }
    }
}

/// One of a post's images, cropped to `ratio` (width over height) across the card.
private struct PostImageView: View {
    let postId: String
    let image: PostImage
    let ratio: CGFloat

    @Environment(\.postImages) private var images
    @Environment(\.displayScale) private var scale
    @State private var loaded: Image?

    var body: some View {
        Color.clear
            .aspectRatio(ratio, contentMode: .fit)
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
                guard loaded == nil, let images else { return }
                loaded = await images.load(postId, image.mediaId, side: Int(480 * scale))
            }
    }
}

/// The images picked for the post being written, each with an X that takes it out.
struct PickedImages: View {
    let paths: [String]
    let onRemove: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(paths, id: \.self) { path in
                    PickedThumbnail(path: path) { onRemove(path) }
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
        }
    }
}

private struct PickedThumbnail: View {
    let path: String
    let onRemove: () -> Void

    @Environment(\.displayScale) private var scale
    @State private var loaded: Image?

    var body: some View {
        Color.clear
            .frame(width: 72, height: 72)
            .background(BrandTokens.Colors.muted)
            .overlay {
                if let loaded {
                    loaded.resizable().scaledToFill()
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(alignment: .topTrailing) {
                Button(action: onRemove) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(BrandTokens.Colors.fg)
                        .frame(width: 22, height: 22)
                        .background(BrandTokens.Colors.surface, in: Circle())
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("post_image_remove"))
                .offset(x: 11, y: -11)
            }
            .padding(.top, 11)
            .padding(.trailing, 11)
            .task(id: path) {
                let side = Int(144 * scale)
                loaded = try? await offMain { postPhoto(path, side: side).map { Image(uiImage: $0) } }
            }
    }
}
