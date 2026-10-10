import ImageIO
import SpjallCore
import UniformTypeIdentifiers
import XCTest

@testable import Spjall

final class PhotoCacheTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)

    /// A cache whose "image" is the path it was decoded from; a file named `bad` is not an image.
    private func cache(capacity: Int = 64) -> PhotoCache<String> {
        PhotoCache(account: account, capacity: capacity) { path in path == "bad" ? nil : "image of \(path)" }
    }

    private func fetches(_ account: String, _ version: String) -> Int {
        self.account.calls.filter { $0 == "photo \(account) \(version)" }.count
    }

    func testAPhotoIsDecodedOnceAndThenKept() async {
        account.photoFiles = ["a2/v1": "a2.webp"]
        let photos = cache()
        let photo = PhotoOf(account: "a2", version: "v1")
        XCTAssertNil(photos.kept(photo), "nothing is kept before it is asked for")
        let first = await photos.load(photo)
        let second = await photos.load(photo)
        XCTAssertEqual(first, "image of a2.webp")
        XCTAssertEqual(second, "image of a2.webp")
        XCTAssertEqual(photos.kept(photo), "image of a2.webp")
        XCTAssertEqual(fetches("a2", "v1"), 1)
    }

    func testANewVersionIsFetchedAgain() async {
        account.photoFiles = ["a2/v1": "old.webp", "a2/v2": "new.webp"]
        let photos = cache()
        _ = await photos.load(PhotoOf(account: "a2", version: "v1"))
        let changed = await photos.load(PhotoOf(account: "a2", version: "v2"))
        XCTAssertEqual(changed, "image of new.webp")
        XCTAssertEqual(fetches("a2", "v2"), 1)
    }

    func testNoPhotoAFailureOrABadFileIsNilAndAskedAgainNextTime() async {
        let photos = cache()
        let none = PhotoOf(account: "a2", version: "v1")
        let bad = PhotoOf(account: "a3", version: "v1")
        account.photoFiles = ["a3/v1": "bad"]
        let failing = PhotoOf(account: "a4", version: "v1")
        account.failOn = "photo a4 v1"

        for _ in 0..<2 {
            let results = [await photos.load(none), await photos.load(bad), await photos.load(failing)]
            XCTAssertEqual(results, [nil, nil, nil])
        }
        XCTAssertEqual([fetches("a2", "v1"), fetches("a3", "v1"), fetches("a4", "v1")], [2, 2, 2])
    }

    func testOnlyTheLastFewAreKept() async {
        account.photoFiles = ["a1/v": "1", "a2/v": "2", "a3/v": "3"]
        let photos = cache(capacity: 2)
        let one = PhotoOf(account: "a1", version: "v")
        let two = PhotoOf(account: "a2", version: "v")
        let three = PhotoOf(account: "a3", version: "v")
        _ = await photos.load(one)
        _ = await photos.load(two)
        XCTAssertNotNil(photos.kept(one), "drawing it again makes it the most recent")
        _ = await photos.load(three)
        XCTAssertNotNil(photos.kept(one))
        XCTAssertNil(photos.kept(two))
        XCTAssertNotNil(photos.kept(three))
    }

    func testAOneToOneShowsTheOtherPersonsPhotoAndAGroupItsInitials() {
        var anna = person("a2", "Anna")
        anna.photo = "v3"
        var bjarni = person("a3", "Bjarni")
        bjarni.photo = "v1"
        XCTAssertEqual(photoOf(conversation("c1", members: [anna])), PhotoOf(account: "a2", version: "v3"))
        XCTAssertNil(photoOf(conversation("c2", members: [anna, bjarni])))
        XCTAssertNil(photoOf(conversation("c3", members: [person("a4", "Dóra")])))
    }
}

final class SquarePhotoTests: XCTestCase {
    private var made: [URL] = []

    override func tearDown() {
        for file in made { try? FileManager.default.removeItem(at: file) }
        super.tearDown()
    }

    func testALargePhotoBecomesASquareFromItsMiddleWithoutItsLocation() throws {
        // Wide, with only the middle third green, and a location in its metadata.
        let original = try write(width: 3000, height: 1000, orientation: 1, gps: true) { context in
            context.setFillColor(red: 0, green: 0, blue: 1, alpha: 1)
            context.fill(CGRect(x: 0, y: 0, width: 3000, height: 1000))
            context.setFillColor(red: 0, green: 1, blue: 0, alpha: 1)
            context.fill(CGRect(x: 1000, y: 0, width: 1000, height: 1000))
        }
        let square = try squarePhoto(original, side: 512)
        made.append(square)
        let image = try XCTUnwrap(read(square))
        XCTAssertEqual([image.width, image.height], [512, 512])
        for (x, y) in [(10, 10), (256, 256), (500, 500)] {
            XCTAssertEqual(color(image, x: x, y: y), .green, "(\(x), \(y)) is from the middle")
        }
        let source = try XCTUnwrap(CGImageSourceCreateWithURL(square as CFURL, nil))
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        XCTAssertNil(properties?[kCGImagePropertyGPSDictionary], "the location must not go with it")
    }

    func testASmallPhotoIsNotMadeLarger() throws {
        let original = try write(width: 200, height: 200, orientation: 1, gps: false) { context in
            context.setFillColor(red: 0, green: 1, blue: 0, alpha: 1)
            context.fill(CGRect(x: 0, y: 0, width: 200, height: 200))
        }
        let square = try squarePhoto(original, side: 512)
        made.append(square)
        let image = try XCTUnwrap(read(square))
        XCTAssertEqual([image.width, image.height], [200, 200])
    }

    func testASidewaysPhotoIsTurnedUpright() throws {
        // Stored with its left half red; orientation 6 shows it turned a quarter clockwise, red on top.
        let original = try write(width: 200, height: 200, orientation: 6, gps: false) { context in
            context.setFillColor(red: 0, green: 0, blue: 1, alpha: 1)
            context.fill(CGRect(x: 0, y: 0, width: 200, height: 200))
            context.setFillColor(red: 1, green: 0, blue: 0, alpha: 1)
            context.fill(CGRect(x: 0, y: 0, width: 100, height: 200))
        }
        let square = try squarePhoto(original, side: 512)
        made.append(square)
        let image = try XCTUnwrap(read(square))
        XCTAssertEqual(color(image, x: 100, y: 20), .red)
        XCTAssertEqual(color(image, x: 100, y: 180), .blue)
    }

    func testAFileThatIsNotAPhotoIsRefused() throws {
        let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".jpg")
        made.append(file)
        try Data("not a photo".utf8).write(to: file)
        XCTAssertThrowsError(try squarePhoto(file, side: 512))
    }

    private enum Color { case red, green, blue, other }

    /// A JPEG of `width` × `height` drawn by `draw`, with an EXIF orientation and, when asked, a location.
    private func write(
        width: Int, height: Int, orientation: Int, gps: Bool, draw: (CGContext) -> Void
    ) throws -> URL {
        let context = try XCTUnwrap(
            CGContext(
                data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        draw(context)
        let image = try XCTUnwrap(context.makeImage())
        let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".jpg")
        made.append(file)
        let destination = try XCTUnwrap(
            CGImageDestinationCreateWithURL(file as CFURL, UTType.jpeg.identifier as CFString, 1, nil))
        var properties: [CFString: Any] = [kCGImagePropertyOrientation: orientation]
        if gps {
            properties[kCGImagePropertyGPSDictionary] = [
                kCGImagePropertyGPSLatitude: 64.1, kCGImagePropertyGPSLatitudeRef: "N",
                kCGImagePropertyGPSLongitude: 21.9, kCGImagePropertyGPSLongitudeRef: "W",
            ]
        }
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return file
    }

    private func read(_ url: URL) -> CGImage? {
        CGImageSourceCreateWithURL(url as CFURL, nil).flatMap { CGImageSourceCreateImageAtIndex($0, 0, nil) }
    }

    /// The colour at (`x`, `y`), `y` counted from the top, within JPEG's error.
    private func color(_ image: CGImage, x: Int, y: Int) -> Color {
        var pixels = [UInt8](repeating: 0, count: image.width * image.height * 4)
        pixels.withUnsafeMutableBytes { bytes in
            let context = CGContext(
                data: bytes.baseAddress, width: image.width, height: image.height, bitsPerComponent: 8,
                bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
            context?.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        }
        let at = (y * image.width + x) * 4
        let (red, green, blue) = (pixels[at], pixels[at + 1], pixels[at + 2])
        switch (red > 200, green > 200, blue > 200) {
        case (true, false, false) where green < 60 && blue < 60: return .red
        case (false, true, false) where red < 60 && blue < 60: return .green
        case (false, false, true) where red < 60 && green < 60: return .blue
        default: return .other
        }
    }
}
