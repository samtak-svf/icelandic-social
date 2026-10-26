import ImageIO
import SpjallCore
import UIKit
import UniformTypeIdentifiers
import XCTest

@testable import Spjall

final class PhotoCacheTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)
    private let social = FakeSocial()

    /// A cache whose "image" is the path it was decoded from; a file named `bad` is not an image.
    private func cache(capacity: Int = 64) -> PhotoCache<String> {
        PhotoCache(account: account, social: social, capacity: capacity) { _, path in
            path == "bad" ? nil : "image of \(path)"
        }
    }

    private func fetches(_ account: String, _ version: String) -> Int {
        self.account.calls.filter { $0 == "photoFramed \(account) \(version) square" }.count
    }

    func testAPhotoIsDecodedOnceAndThenKept() async {
        account.photoFiles = ["a2/v1": "a2.webp"]
        let photos = cache()
        let photo = PhotoOf(owner: "a2", version: "v1")
        XCTAssertNil(photos.kept(photo), "nothing is kept before it is asked for")
        let first = await photos.load(photo)
        let second = await photos.load(photo)
        XCTAssertEqual(first, "image of a2.webp")
        XCTAssertEqual(second, "image of a2.webp")
        XCTAssertEqual(photos.kept(photo), "image of a2.webp")
        XCTAssertEqual(fetches("a2", "v1"), 1)
    }

    func testACommunityPictureAndCoverLoadThroughTheCoreFunctionOfTheirKind() async {
        social.pictureFiles = ["k1/v1": "picture.webp"]
        social.coverFiles = ["k1/v1": "cover.webp"]
        let photos = cache()
        let picture = PhotoOf(owner: "k1", version: "v1", kind: .communityPicture)
        let cover = PhotoOf(owner: "k1", version: "v1", kind: .communityCover)
        let loadedPicture = await photos.load(picture)
        let loadedCover = await photos.load(cover)
        XCTAssertEqual(loadedPicture, "image of picture.webp")
        XCTAssertEqual(loadedCover, "image of cover.webp")
        XCTAssertEqual(social.calls, ["communityPictureFramed k1 v1 square", "communityCoverFramed k1 v1 square"])
        XCTAssertEqual(account.calls.filter { $0.hasPrefix("photoFramed") }, [], "a community is not an account")
        _ = await photos.load(picture)
        _ = await photos.load(cover)
        XCTAssertEqual(social.calls.count, 2, "each kind is kept under its own key")
    }

    func testACommunityWithNoPictureOrCoverIsNilAndAskedAgainNextTime() async {
        let photos = cache()
        let picture = PhotoOf(owner: "k1", version: "v1", kind: .communityPicture)
        let cover = PhotoOf(owner: "k1", version: "v1", kind: .communityCover)
        for _ in 0..<2 {
            let results = [await photos.load(picture), await photos.load(cover)]
            XCTAssertEqual(results, [nil, nil])
        }
        XCTAssertEqual(social.calls.count, 4)
    }

    func testAMembersPhotoIsTheAccountsAndACommunitysTheCommunitys() {
        XCTAssertEqual(makeMember("a2", "Anna", photo: "v3").photoOf, PhotoOf(owner: "a2", version: "v3"))
        XCTAssertNil(makeMember("a3", "Bjarni").photoOf)
        var community = makeCommunity("k1", "Gróa")
        XCTAssertNil(community.pictureOf)
        XCTAssertNil(community.coverOf(.compact))
        community.photo = "p1"
        community.cover = "c1"
        XCTAssertEqual(community.pictureOf, PhotoOf(owner: "k1", version: "p1", kind: .communityPicture))
        XCTAssertEqual(
            community.coverOf(.expanded),
            PhotoOf(owner: "k1", version: "c1", kind: .communityCover, frame: .expanded))
        XCTAssertEqual(community.pictureOf?.frame, .square, "a picture is always the square frame")
    }

    func testAGroupsPhotoIsItsFileAndAOneToOnesIsThePerson() throws {
        let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".jpg")
        try Data([1, 2, 3]).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        var gunna = person("a2", "Gunna")
        gunna.photo = "v3"
        let members = [gunna, person("a3", "Siggi")]
        let group = photoOf(conversation("c1", members: members, name: "Bókaklúbbur", photo: file.path))
        XCTAssertEqual(group?.kind, .groupFile)
        XCTAssertEqual(group?.owner, file.path)
        XCTAssertNil(photoOf(conversation("c2", members: members, name: "Bókaklúbbur")), "a group with none")
        XCTAssertNil(photoOf(conversation("c3", members: members)), "a group without a name has no photo either")
        let one = photoOf(conversation("c4", members: [gunna]))
        XCTAssertEqual(one, PhotoOf(owner: "a2", version: "v3"))
    }

    func testAReplacedGroupPhotoIsANewKeyAndIsLoadedFromDisk() async {
        let before = PhotoOf.groupFile(path: "/media/g1.jpg", stamp: "100-10")
        let after = PhotoOf.groupFile(path: "/media/g1.jpg", stamp: "200-12")
        XCTAssertNotEqual(before, after)
        XCTAssertEqual(before, PhotoOf.groupFile(path: "/media/g1.jpg", stamp: "100-10"))
        let photos = cache()
        let first = await photos.load(before)
        let second = await photos.load(after)
        XCTAssertEqual(first, "image of /media/g1.jpg")
        XCTAssertEqual(second, "image of /media/g1.jpg")
        XCTAssertNotNil(photos.kept(before))
        XCTAssertNotNil(photos.kept(after))
        XCTAssertEqual(account.calls.filter { $0.hasPrefix("photoFramed") }, [], "a group photo is the core's file")
    }

    func testANewVersionIsFetchedAgain() async {
        account.photoFiles = ["a2/v1": "old.webp", "a2/v2": "new.webp"]
        let photos = cache()
        _ = await photos.load(PhotoOf(owner: "a2", version: "v1"))
        let changed = await photos.load(PhotoOf(owner: "a2", version: "v2"))
        XCTAssertEqual(changed, "image of new.webp")
        XCTAssertEqual(fetches("a2", "v2"), 1)
    }

    func testNoPhotoAFailureOrABadFileIsNilAndAskedAgainNextTime() async {
        let photos = cache()
        let none = PhotoOf(owner: "a2", version: "v1")
        let bad = PhotoOf(owner: "a3", version: "v1")
        account.photoFiles = ["a3/v1": "bad"]
        let failing = PhotoOf(owner: "a4", version: "v1")
        account.failOn = "photoFramed a4 v1 square"

        for _ in 0..<2 {
            let results = [await photos.load(none), await photos.load(bad), await photos.load(failing)]
            XCTAssertEqual(results, [nil, nil, nil])
        }
        XCTAssertEqual([fetches("a2", "v1"), fetches("a3", "v1"), fetches("a4", "v1")], [2, 2, 2])
    }

    func testOnlyTheLastFewAreKept() async {
        account.photoFiles = ["a1/v": "1", "a2/v": "2", "a3/v": "3"]
        let photos = cache(capacity: 2)
        let one = PhotoOf(owner: "a1", version: "v")
        let two = PhotoOf(owner: "a2", version: "v")
        let three = PhotoOf(owner: "a3", version: "v")
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
        XCTAssertEqual(photoOf(conversation("c1", members: [anna])), PhotoOf(owner: "a2", version: "v3"))
        XCTAssertNil(photoOf(conversation("c2", members: [anna, bjarni])))
        XCTAssertNil(photoOf(conversation("c3", members: [person("a4", "Dóra")])))
    }
}

final class MasterPhotoTests: XCTestCase {
    private var made: [URL] = []

    override func tearDown() {
        for file in made { try? FileManager.default.removeItem(at: file) }
        super.tearDown()
    }

    func testALargePhotoBecomesAMasterWithItsShapeAndWithoutItsLocation() throws {
        // Wide, left third red, with a location in its metadata: nothing is cropped, only scaled.
        let original = try write(width: 4800, height: 1200, orientation: 1, gps: true) { context in
            context.setFillColor(red: 0, green: 0, blue: 1, alpha: 1)
            context.fill(CGRect(x: 0, y: 0, width: 4800, height: 1200))
            context.setFillColor(red: 1, green: 0, blue: 0, alpha: 1)
            context.fill(CGRect(x: 0, y: 0, width: 1600, height: 1200))
        }
        let master = try masterPhoto(original)
        made.append(master)
        let image = try XCTUnwrap(read(master))
        XCTAssertEqual([image.width, image.height], [2400, 600], "the long edge is 2400 and the shape is kept")
        XCTAssertEqual(color(image, x: 100, y: 300), .red)
        XCTAssertEqual(color(image, x: 2300, y: 300), .blue)
        let source = try XCTUnwrap(CGImageSourceCreateWithURL(master as CFURL, nil))
        XCTAssertEqual(CGImageSourceGetType(source) as String?, UTType.jpeg.identifier)
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        XCTAssertNil(properties?[kCGImagePropertyGPSDictionary], "the location must not go with it")
    }

    func testASmallPhotoIsNeverScaledUp() throws {
        let original = try write(width: 200, height: 100, orientation: 1, gps: false) { context in
            context.setFillColor(red: 0, green: 1, blue: 0, alpha: 1)
            context.fill(CGRect(x: 0, y: 0, width: 200, height: 100))
        }
        let master = try masterPhoto(original)
        made.append(master)
        let image = try XCTUnwrap(read(master))
        XCTAssertEqual([image.width, image.height], [200, 100])
    }

    func testASidewaysPhotoBecomesAnUprightMaster() throws {
        // Stored 200 x 100 with its left half red; orientation 6 shows it turned a quarter clockwise, red on top.
        let original = try write(width: 200, height: 100, orientation: 6, gps: false) { context in
            context.setFillColor(red: 0, green: 0, blue: 1, alpha: 1)
            context.fill(CGRect(x: 0, y: 0, width: 200, height: 100))
            context.setFillColor(red: 1, green: 0, blue: 0, alpha: 1)
            context.fill(CGRect(x: 0, y: 0, width: 100, height: 100))
        }
        let master = try masterPhoto(original)
        made.append(master)
        let image = try XCTUnwrap(read(master))
        XCTAssertEqual([image.width, image.height], [100, 200])
        XCTAssertEqual(color(image, x: 50, y: 20), .red)
        XCTAssertEqual(color(image, x: 50, y: 180), .blue)
        let source = try XCTUnwrap(CGImageSourceCreateWithURL(master as CFURL, nil))
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        XCTAssertEqual(properties?[kCGImagePropertyOrientation] as? Int ?? 1, 1, "upright in its pixels")
    }

    func testAMasterStepsItsQualityDownToStayUnderTheLimit() throws {
        // Noise does not compress, so a tight limit forces the lowest quality; an absurd one is refused.
        let original = try write(width: 600, height: 600, orientation: 1, gps: false) { context in
            for y in stride(from: 0, to: 600, by: 3) {
                for x in stride(from: 0, to: 600, by: 3) {
                    context.setFillColor(
                        red: .random(in: 0...1), green: .random(in: 0...1), blue: .random(in: 0...1), alpha: 1)
                    context.fill(CGRect(x: x, y: y, width: 3, height: 3))
                }
            }
        }
        let roomy = try masterPhoto(original)
        made.append(roomy)
        let roomySize = try XCTUnwrap(try roomy.resourceValues(forKeys: [.fileSizeKey]).fileSize)
        let tight = try masterPhoto(original, limit: roomySize - 1)
        made.append(tight)
        let tightSize = try XCTUnwrap(try tight.resourceValues(forKeys: [.fileSizeKey]).fileSize)
        XCTAssertLessThan(tightSize, roomySize)
        XCTAssertLessThanOrEqual(tightSize, roomySize - 1)
        XCTAssertThrowsError(try masterPhoto(original, limit: 10))
    }

    func testAFileThatIsNotAPhotoIsRefused() throws {
        let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".jpg")
        made.append(file)
        try Data("not a photo".utf8).write(to: file)
        XCTAssertThrowsError(try masterPhoto(file))
    }

    func testACameraPhotoIsWrittenUprightWithItsPixelsOnly() throws {
        // Stored 200 × 100 with its left half red; `.right` shows it turned a quarter clockwise, red on top.
        let context = try XCTUnwrap(
            CGContext(
                data: nil, width: 200, height: 100, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        context.setFillColor(red: 0, green: 0, blue: 1, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: 200, height: 100))
        context.setFillColor(red: 1, green: 0, blue: 0, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: 100, height: 100))
        let taken = UIImage(cgImage: try XCTUnwrap(context.makeImage()), scale: 1, orientation: .right)

        let file = try cameraPhoto(taken)
        made.append(file)
        let image = try XCTUnwrap(read(file))
        XCTAssertEqual([image.width, image.height], [100, 200])
        XCTAssertEqual(color(image, x: 50, y: 20), .red)
        XCTAssertEqual(color(image, x: 50, y: 180), .blue)
        let source = try XCTUnwrap(CGImageSourceCreateWithURL(file as CFURL, nil))
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        XCTAssertNil(properties?[kCGImagePropertyGPSDictionary], "no location goes with it")
        XCTAssertEqual(properties?[kCGImagePropertyOrientation] as? Int ?? 1, 1, "upright in its pixels")
    }

    func testAPickedPhotoLosesItsLocationAndKeepsItsBytesOtherwise() throws {
        let original = try write(width: 200, height: 100, orientation: 6, gps: true) { context in
            context.setFillColor(red: 1, green: 0, blue: 0, alpha: 1)
            context.fill(CGRect(x: 0, y: 0, width: 200, height: 100))
        }
        let pixels = try XCTUnwrap(read(original)).dataProvider?.data as Data?
        let before = try XCTUnwrap(CGImageSourceCreateWithURL(original as CFURL, nil))
        let had = CGImageSourceCopyPropertiesAtIndex(before, 0, nil) as? [CFString: Any]
        XCTAssertNotNil(had?[kCGImagePropertyGPSDictionary], "the photo had a location to lose")
        XCTAssertEqual(had?[kCGImagePropertyOrientation] as? Int, 6, "the photo was written on its side")
        let stripped = withoutLocation(original)
        made.append(stripped)
        XCTAssertNotEqual(stripped, original)
        XCTAssertFalse(FileManager.default.fileExists(atPath: original.path), "the copy with a location is gone")
        let source = try XCTUnwrap(CGImageSourceCreateWithURL(stripped as CFURL, nil))
        XCTAssertEqual(CGImageSourceGetType(source) as String?, UTType.jpeg.identifier)
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        XCTAssertNil(properties?[kCGImagePropertyGPSDictionary], "no location goes with a picked photo (0048)")
        XCTAssertEqual(properties?[kCGImagePropertyOrientation] as? Int, 6, "which way is up stays")
        XCTAssertEqual(try XCTUnwrap(read(stripped)).dataProvider?.data as Data?, pixels, "not encoded again")
    }

    func testWhatIsNotAPhotoGoesAsItIs() throws {
        let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        made.append(file)
        try Data("not a photo".utf8).write(to: file)
        XCTAssertEqual(withoutLocation(file), file)
        XCTAssertEqual(try Data(contentsOf: file), Data("not a photo".utf8))
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
