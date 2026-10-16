import ImageIO
import SpjallCore
import SwiftUI

extension Item {
    /// Whether this is drawn edge to edge in its bubble (0053): a photo that has not failed to
    /// download. The bubble's padding then goes round its caption only.
    func edgeToEdge(_ media: ConversationModel.Media?) -> Bool {
        guard case .media(let mime, _, _, _) = content else { return false }
        return mime.hasPrefix("image/") && media != .failed
    }

    /// A photo with nothing round it, drawn as the photo alone with the bubble's shape and no frame.
    func bare(_ media: ConversationModel.Media?) -> Bool {
        guard edgeToEdge(media), case .media(_, _, let caption, _) = content else { return false }
        return caption == nil && !forwarded
    }
}

/// The photo above, then its caption wrapped at the photo's width rather than widening the bubble.
private struct PhotoAndCaption: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let sizes = measure(proposal, subviews)
        return CGSize(width: sizes.first?.width ?? 0, height: sizes.reduce(0) { $0 + $1.height })
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for (subview, size) in zip(subviews, measure(proposal, subviews)) {
            subview.place(at: CGPoint(x: bounds.minX, y: y), proposal: ProposedViewSize(size))
            y += size.height
        }
    }

    private func measure(_ proposal: ProposedViewSize, _ subviews: Subviews) -> [CGSize] {
        guard let photo = subviews.first?.sizeThatFits(proposal) else { return [] }
        let below = subviews.dropFirst().map { $0.sizeThatFits(ProposedViewSize(width: photo.width, height: nil)) }
        return [photo] + below.map { CGSize(width: photo.width, height: $0.height) }
    }
}

/// A photo or file in a bubble. A photo downloads as soon as its bubble shows;
/// a file waits for a tap, which opens it in a preview either way.
struct Attachment: View {
    let item: Item
    let mime: String
    let size: UInt64
    let caption: String?
    /// The sender's name for the file, shown in place of "file" when there is one.
    let name: String?
    let foreground: Color
    let model: ConversationModel

    private var media: ConversationModel.Media? { item.seq.flatMap { model.media[$0] } }

    private var ready: String? {
        if case .ready(let path) = media { path } else { nil }
    }

    var body: some View {
        if item.edgeToEdge(media) {
            // The bubble clips the photo to its shape (0053); only the caption is padded.
            PhotoAndCaption {
                photo
                if let caption {
                    Text(verbatim: caption)
                        .foregroundStyle(foreground)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 11)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } else {
            padded
        }
    }

    private var photo: some View {
        Photo(path: ready, label: localized("photo"))
            .onTapGesture { Task { await model.open(item) } }
            .task(id: item.seq) { if media == nil { await model.fetch(item) } }
    }

    private var padded: some View {
        VStack(alignment: .leading, spacing: 4) {
            if media == .failed {
                VStack(alignment: .leading, spacing: 4) {
                    Text("media_download_failed").font(.subheadline)
                    Button("try_again") { Task { await model.fetch(item) } }
                }
                .foregroundStyle(foreground)
            } else {
                Button {
                    Task { await model.open(item) }
                } label: {
                    HStack(spacing: 8) {
                        if media == .loading {
                            ProgressView().tint(foreground)
                        } else {
                            Image(systemName: "doc").accessibilityHidden(true)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            if let name { Text(verbatim: name) } else { Text("file") }
                            Text(verbatim: ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
                                .font(.footnote)
                        }
                    }
                    .frame(minHeight: 44)
                }
                .foregroundStyle(foreground)
            }
            if let caption { Text(verbatim: caption).foregroundStyle(foreground) }
        }
    }
}

private struct Photo: View {
    static let size: CGFloat = 240

    let path: String?
    let label: String

    @State private var image: UIImage?
    @State private var unreadable = false
    @Environment(\.displayScale) private var scale

    var body: some View {
        Group {
            if let image {
                PhotoImage(image: image, longest: Self.size)
                    .accessibilityLabel(Text(verbatim: label))
                    .accessibilityAddTraits(.isImage)
            } else if unreadable {
                Image(systemName: "photo")
                    .font(.largeTitle)
                    .frame(width: Self.size / 2, height: Self.size / 2)
                    .background(BrandTokens.Colors.muted)
                    .accessibilityLabel(Text(verbatim: label))
            } else {
                ProgressView()
                    .frame(width: Self.size / 2, height: Self.size / 2)
                    .background(BrandTokens.Colors.muted)
            }
        }
        .task(id: path) {
            guard let path else { return }
            let longest = Self.size * scale
            image = await Task.detached(priority: .userInitiated) { decodePhoto(path, longest: longest) }.value
            unreadable = image == nil
        }
    }
}

/// A photo at exactly its own shape, its longest side `longest` points. A frame of at most that
/// size would be square round a tall or wide photo, so the bubble's edge and rounded corners
/// (0053) would fall on empty space beside it.
struct PhotoImage: View {
    let image: UIImage
    let longest: CGFloat

    var body: some View {
        let size = fitted(image.size, longest: longest)
        Image(uiImage: image).resizable().frame(width: size.width, height: size.height)
    }
}

/// `size` scaled so that its longest side is `longest`.
func fitted(_ size: CGSize, longest: CGFloat) -> CGSize {
    let side = max(size.width, size.height)
    guard side > 0 else { return CGSize(width: longest, height: longest) }
    return CGSize(width: size.width * longest / side, height: size.height * longest / side)
}

/// The photo at `path`, no longer than `longest` pixels, turned the way it was taken.
func decodePhoto(_ path: String, longest: CGFloat) -> UIImage? {
    guard let source = CGImageSourceCreateWithURL(URL(filePath: path) as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: longest,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    return UIImage(cgImage: image)
}
