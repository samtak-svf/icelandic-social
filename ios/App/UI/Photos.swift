import Foundation
import ImageIO
import SpjallCore
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// A picture the core keeps, at the version the server named: an account's profile photo (decision 0039), or a
/// community's picture or cover (decision 0080). All three load through one `PhotoCache`.
struct PhotoOf: Hashable, Sendable {
    enum Kind: Hashable, Sendable {
        case account
        case communityPicture
        case communityCover
        /// An account's wall cover (decision 0115): the owner is the account id.
        case wallCover
        /// A group's photo: the core's own file on this device, not something fetched (decision 0094).
        case groupFile
    }

    /// The account id, or for the community kinds the community id.
    let owner: String
    let version: String
    var kind = Kind.account
    /// The frame to fetch (decision 0086): a cover's follows the window's size class, everything else is square.
    var frame = Frame.square

    /// A group's photo at `path`. A replace rewrites the same path, so `stamp` (see `fileStamp`) is the version: a
    /// new photo is a new key and is not served from the old picture in memory.
    static func groupFile(path: String, stamp: String) -> PhotoOf {
        PhotoOf(owner: path, version: stamp, kind: .groupFile)
    }
}

/// What tells one write of the file at `path` from the next: its modification time and size.
func fileStamp(_ path: String) -> String {
    let attributes = try? FileManager.default.attributesOfItem(atPath: path)
    let modified = (attributes?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
    let size = (attributes?[.size] as? NSNumber)?.int64Value ?? 0
    return "\(modified)-\(size)"
}

extension Person {
    /// The photo to draw for this person, or nil when the server gave none.
    var photoOf: PhotoOf? { photo.map { PhotoOf(owner: account, version: $0) } }
}

extension Author {
    /// The photo to draw for this author, or nil when the server gave none (decision 0080).
    var photoOf: PhotoOf? { photo.map { PhotoOf(owner: accountId, version: $0) } }
}

extension CommunityMember {
    /// The photo to draw for this member, or nil when the account has none (decision 0080).
    var photoOf: PhotoOf? { photo.map { PhotoOf(owner: accountId, version: $0) } }
}

extension Community {
    /// The community's picture, or nil when it has none (decision 0080).
    var pictureOf: PhotoOf? { photo.map { PhotoOf(owner: communityId, version: $0, kind: .communityPicture) } }

    /// The community's cover in `frame`, or nil when it has none (decisions 0080, 0086).
    func coverOf(_ frame: Frame) -> PhotoOf? {
        cover.map { PhotoOf(owner: communityId, version: $0, kind: .communityCover, frame: frame) }
    }
}

extension WallProfile {
    /// The wall's cover in `frame`, or nil when it has none (decision 0115).
    func coverOf(_ frame: Frame) -> PhotoOf? {
        cover.map { PhotoOf(owner: accountId, version: $0, kind: .wallCover, frame: frame) }
    }
}

extension CardCommunity {
    /// The picture of the community a card is in, or nil when it has none (decision 0080).
    var pictureOf: PhotoOf? { photo.map { PhotoOf(owner: communityId, version: $0, kind: .communityPicture) } }
}

extension Me {
    /// This account's own photo, or nil when it has none.
    var photoOf: PhotoOf? { photo.map { PhotoOf(owner: accountId, version: $0) } }
}

/// A 1:1's photo is the other person's (decision 0039); a group's is its own picture when it has one, else its
/// avatar stays initials (decision 0094).
func photoOf(_ conversation: Conversation) -> PhotoOf? {
    if conversation.name == nil && conversation.members.count == 1 { return conversation.members.first?.photoOf }
    return conversation.photo.map { PhotoOf.groupFile(path: $0, stamp: fileStamp($0)) }
}

/// Decoded pictures by owner, kind and version, the last `capacity` in memory only.
/// The file stays the core's, in its media folder (decision 0039): nothing here
/// writes one.
final class PhotoCache<Image: Sendable>: @unchecked Sendable {
    private let account: Account
    private let social: Social
    private let capacity: Int
    private let decode: @Sendable (PhotoOf.Kind, String) -> Image?
    private let lock = NSLock()
    private var images: [PhotoOf: Image] = [:]
    /// Least recently used first.
    private var order: [PhotoOf] = []

    init(
        account: Account, social: Social, capacity: Int = 64,
        decode: @escaping @Sendable (PhotoOf.Kind, String) -> Image?
    ) {
        self.account = account
        self.social = social
        self.capacity = capacity
        self.decode = decode
    }

    /// The photo when it is already in memory, so a row drawn again does not flash its initials.
    func kept(_ photo: PhotoOf) -> Image? {
        lock.withLock {
            guard let image = images[photo] else { return nil }
            order.removeAll { $0 == photo }
            order.append(photo)
            return image
        }
    }

    /// The photo, fetched by the core when it has not kept it yet; nil for none, or
    /// when it cannot be had now (offline, refused, not an image), so the next draw asks again.
    func load(_ photo: PhotoOf) async -> Image? {
        if let image = kept(photo) { return image }
        let (account, social, decode) = (account, social, decode)
        guard
            let image = try? await offMain({ () throws -> Image? in
                let path: String?
                switch photo.kind {
                case .account:
                    path = try account.photoFramed(account: photo.owner, version: photo.version, frame: photo.frame)
                case .communityPicture:
                    path = try social.communityPictureFramed(photo.owner, version: photo.version, frame: photo.frame)
                case .communityCover:
                    path = try social.communityCoverFramed(photo.owner, version: photo.version, frame: photo.frame)
                case .wallCover:
                    path = try social.wallCoverFramed(photo.owner, version: photo.version, frame: photo.frame)
                case .groupFile:
                    path = photo.owner
                }
                return path.flatMap { decode(photo.kind, $0) }
            })
        else { return nil }
        lock.withLock {
            if images.updateValue(image, forKey: photo) == nil { order.append(photo) }
            while order.count > capacity { images[order.removeFirst()] = nil }
        }
        return image
    }
}

private struct PhotosKey: EnvironmentKey {
    static let defaultValue: PhotoCache<UIImage>? = nil
}

extension EnvironmentValues {
    /// Where `Avatar` gets photos from; nil draws initials only.
    var photos: PhotoCache<UIImage>? {
        get { self[PhotosKey.self] }
        set { self[PhotosKey.self] = newValue }
    }
}

/// A picture from the cache, or `placeholder` while it loads, when there is none and when it cannot be had
/// (decisions 0039 and 0080). `Avatar` and the community views all draw through this one view.
struct LoadedPhoto<Picture: View, Placeholder: View>: View {
    let photo: PhotoOf?
    let picture: (UIImage) -> Picture
    let placeholder: () -> Placeholder

    @Environment(\.photos) private var photos
    @State private var loaded: UIImage?

    init(
        _ photo: PhotoOf?, @ViewBuilder picture: @escaping (UIImage) -> Picture,
        @ViewBuilder placeholder: @escaping () -> Placeholder
    ) {
        self.photo = photo
        self.picture = picture
        self.placeholder = placeholder
    }

    var body: some View {
        ZStack {
            if let image = photo.flatMap({ photo in loaded ?? photos?.kept(photo) }) {
                picture(image)
            } else {
                placeholder()
            }
        }
        .task(id: photo) {
            loaded = nil
            guard let photo, let photos else { return }
            loaded = await photos.load(photo)
        }
    }
}

/// A picture for the screen: an avatar's or a community's picture is the server's 512 px one, halved, which is
/// about the largest (88 pt) on most screens at a quarter of the memory; a cover keeps 1200 pixels across.
func displayPhoto(_ kind: PhotoOf.Kind, _ path: String) -> UIImage? {
    downsampled(path, maxPixel: kind == .communityCover || kind == .wallCover ? 1200 : 256)
}

private func downsampled(_ path: String, maxPixel: Int) -> UIImage? {
    guard let source = CGImageSourceCreateWithURL(URL(filePath: path) as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxPixel,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    return UIImage(cgImage: image)
}

/// The longest edge of a master, in pixels (decision 0086).
let masterLongEdge = 2400

/// What a master may weigh: the most the server takes.
let masterByteLimit = Limits.imageBytes

/// The photo at `url` as the master the server keeps and frames (decision 0086): upright, its long edge no longer
/// than `longEdge` pixels (never scaled up), written to a new temporary JPEG at quality 0.9, stepping down to 0.6
/// until it weighs no more than `limit` bytes. Only the pixels are written, so none of the original's metadata goes
/// with it; the server re-encodes it anyway, and that is the guarantee. Throws when `url` is not an image, or when
/// even the lowest quality is over `limit`.
func masterPhoto(_ url: URL, longEdge: Int = masterLongEdge, limit: Int = masterByteLimit) throws -> URL {
    let unreadable = CocoaError(.fileReadCorruptFile)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
        let width = properties[kCGImagePropertyPixelWidth] as? Int,
        let height = properties[kCGImagePropertyPixelHeight] as? Int,
        min(width, height) > 0
    else { throw unreadable }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: min(max(width, height), longEdge),
    ]
    guard let upright = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
        let context = CGContext(
            data: nil, width: upright.width, height: upright.height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { throw unreadable }
    // Drawn into an opaque bitmap, so a transparent corner is white rather than whatever JPEG makes of alpha.
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: upright.width, height: upright.height))
    context.interpolationQuality = .high
    context.draw(upright, in: CGRect(x: 0, y: 0, width: upright.width, height: upright.height))
    guard let pixels = context.makeImage() else { throw unreadable }
    for quality in stride(from: 0.9, through: 0.55, by: -0.1) {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)
        else { throw unreadable }
        CGImageDestinationAddImage(
            destination, pixels, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw unreadable }
        if data.length <= limit {
            let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".jpg")
            try (data as Data).write(to: file)
            return file
        }
    }
    throw CocoaError(.fileWriteOutOfSpace)
}

/// The photo at `url` without where it was taken (decision 0048), in a new temporary file of the same type:
/// ImageIO copies its encoded data as it is and leaves the GPS metadata behind, so nothing is encoded again.
/// A type it cannot copy so goes as it is, which the system picker has already stripped of location.
func withoutLocation(_ url: URL) -> URL {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let type = CGImageSourceGetType(source)
    else { return url }
    let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    guard let destination = CGImageDestinationCreateWithURL(file as CFURL, type, 1, nil) else { return url }
    // The photo's own metadata goes with it whole, orientation included, less every GPS tag; ImageIO's
    // kCGImageMetadataShouldExcludeGPS alone also lost the orientation.
    guard let metadata = CGImageSourceCopyMetadataAtIndex(source, 0, nil),
        let kept = CGImageMetadataCreateMutableCopy(metadata)
    else { return url }
    var gps: [String] = []
    CGImageMetadataEnumerateTagsUsingBlock(metadata, nil, nil) { path, tag in
        let namespace = CGImageMetadataTagCopyNamespace(tag) as String?
        let name = CGImageMetadataTagCopyName(tag) as String? ?? ""
        if namespace == kCGImageMetadataNamespaceExif as String && name.hasPrefix("GPS") {
            gps.append(path as String)
        }
        return true
    }
    for path in gps {
        CGImageMetadataRemoveTagWithPath(kept, nil, path as CFString)
    }
    let options: [CFString: Any] = [kCGImageDestinationMetadata: kept, kCGImageDestinationMergeMetadata: false]
    var error: Unmanaged<CFError>?
    guard CGImageDestinationCopyImageSource(destination, source, options as CFDictionary, &error) else {
        try? FileManager.default.removeItem(at: file)
        return url
    }
    try? FileManager.default.removeItem(at: url)
    return file
}

/// A photo the camera took, drawn upright into a new temporary JPEG of its pixels only (decision 0047): no
/// EXIF, no location, nothing but the picture. Throws when it cannot be written.
func cameraPhoto(_ image: UIImage) throws -> URL {
    let unwritable = CocoaError(.fileWriteUnknown)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    format.preferredRange = .standard
    let size = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
    guard size.width >= 1, size.height >= 1 else { throw unwritable }
    // Drawing turns it the way it was taken, so no orientation needs to go with it.
    let upright = UIGraphicsImageRenderer(size: size, format: format).image { _ in
        image.draw(in: CGRect(origin: .zero, size: size))
    }
    let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".jpg")
    guard let pixels = upright.cgImage,
        let destination = CGImageDestinationCreateWithURL(file as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
    else { throw unwritable }
    CGImageDestinationAddImage(destination, pixels, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw unwritable }
    return file
}
