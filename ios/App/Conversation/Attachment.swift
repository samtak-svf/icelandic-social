import ImageIO
import SpjallCore
import SwiftUI

/// A photo or file in a bubble. A photo downloads as soon as its bubble shows;
/// a file waits for a tap, which opens it in a preview either way.
struct Attachment: View {
    let item: Item
    let mime: String
    let size: UInt64
    let caption: String?
    let foreground: Color
    let model: ConversationModel

    private var media: ConversationModel.Media? { item.seq.flatMap { model.media[$0] } }

    private var ready: String? {
        if case .ready(let path) = media { path } else { nil }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if media == .failed {
                VStack(alignment: .leading, spacing: 4) {
                    Text("media_download_failed").font(.subheadline)
                    Button("try_again") { Task { await model.fetch(item) } }
                }
                .foregroundStyle(foreground)
            } else if mime.hasPrefix("image/") {
                Photo(path: ready, label: localized("photo"))
                    .onTapGesture { Task { await model.open(item) } }
                    .task(id: item.seq) { if media == nil { await model.fetch(item) } }
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
                            Text("file")
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
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: Self.size, maxHeight: Self.size)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityLabel(Text(verbatim: label))
                    .accessibilityAddTraits(.isImage)
            } else if unreadable {
                Image(systemName: "photo")
                    .font(.largeTitle)
                    .frame(width: Self.size / 2, height: Self.size / 2)
                    .accessibilityLabel(Text(verbatim: label))
            } else {
                ProgressView().frame(width: Self.size / 2, height: Self.size / 2)
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

/// The photo at `path`, no longer than `longest` pixels, turned the way it was taken.
private func decodePhoto(_ path: String, longest: CGFloat) -> UIImage? {
    guard let source = CGImageSourceCreateWithURL(URL(filePath: path) as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: longest,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    return UIImage(cgImage: image)
}
