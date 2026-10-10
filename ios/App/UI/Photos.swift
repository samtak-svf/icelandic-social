import Foundation
import ImageIO
import SpjallCore
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// An account's profile photo at the version the server named (decision 0039).
struct PhotoOf: Hashable, Sendable {
    let account: String
    let version: String
}

extension Person {
    /// The photo to draw for this person, or nil when the server gave none.
    var photoOf: PhotoOf? { photo.map { PhotoOf(account: account, version: $0) } }
}

extension Me {
    /// This account's own photo, or nil when it has none.
    var photoOf: PhotoOf? { photo.map { PhotoOf(account: accountId, version: $0) } }
}

/// A 1:1's photo is the other person's; a group's avatar stays initials (decision 0039).
func photoOf(_ conversation: Conversation) -> PhotoOf? {
    conversation.members.count == 1 ? conversation.members.first?.photoOf : nil
}

/// Decoded photos by account and version, the last `capacity` in memory only.
/// The file stays the core's, in its media folder (decision 0039): nothing here
/// writes one.
final class PhotoCache<Image: Sendable>: @unchecked Sendable {
    private let account: Account
    private let capacity: Int
    private let decode: @Sendable (String) -> Image?
    private let lock = NSLock()
    private var images: [PhotoOf: Image] = [:]
    /// Least recently used first.
    private var order: [PhotoOf] = []

    init(account: Account, capacity: Int = 64, decode: @escaping @Sendable (String) -> Image?) {
        self.account = account
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
        let (account, decode) = (account, decode)
        guard
            let image = try? await offMain({
                try account.photo(account: photo.account, version: photo.version).flatMap(decode)
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

/// A photo for an avatar: the server's 512 px one, halved, which is about the largest avatar (88 pt) on
/// most screens at a quarter of the memory.
func avatarPhoto(_ path: String) -> UIImage? {
    guard let source = CGImageSourceCreateWithURL(URL(filePath: path) as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: 256,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    return UIImage(cgImage: image)
}

/// The photo at `url` as an upright square from its middle, no larger than `side` pixels, written to a new
/// temporary JPEG (decision 0039). Only the pixels are written, so none of the original's metadata goes with
/// it; the server re-encodes it anyway, and that is the guarantee. Throws when `url` is not an image.
func squarePhoto(_ url: URL, side: Int) throws -> URL {
    let unreadable = CocoaError(.fileReadCorruptFile)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
        let width = properties[kCGImagePropertyPixelWidth] as? Int,
        let height = properties[kCGImagePropertyPixelHeight] as? Int,
        min(width, height) > 0
    else { throw unreadable }
    // Made only as small as keeps the short side, the square's edge, at `side` or more.
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: side * max(width, height) / min(width, height),
    ]
    guard let upright = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
        throw unreadable
    }
    let edge = min(upright.width, upright.height)
    let middle = CGRect(x: (upright.width - edge) / 2, y: (upright.height - edge) / 2, width: edge, height: edge)
    let out = min(edge, side)
    guard let square = upright.cropping(to: middle),
        let context = CGContext(
            data: nil, width: out, height: out, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
    else { throw unreadable }
    context.interpolationQuality = .high
    context.draw(square, in: CGRect(x: 0, y: 0, width: out, height: out))
    let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".jpg")
    guard let small = context.makeImage(),
        let destination = CGImageDestinationCreateWithURL(file as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
    else { throw unreadable }
    CGImageDestinationAddImage(destination, small, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw unreadable }
    return file
}
