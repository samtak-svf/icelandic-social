import SpjallCore
import SwiftUI
import XCTest

@testable import Spjall

/// A real render of two cards a reader sees: the grouped notification row (two people reacted to one post, one row
/// naming both, decision 0103) and the anonymous post card (decision 0091). Each view is hosted in a window,
/// drawn, checked to be a picture and not an empty or flat one, and attached to the result bundle for a person to
/// look at. There is no golden comparison: the attachment is the evidence, the assertions are the precondition.
@MainActor
final class HostedRenderTests: XCTestCase {
    private let width: CGFloat = 390

    /// `view` drawn at the width of a phone and as high as it needs, on a plain background.
    private func render<Content: View>(_ view: Content) async -> UIImage {
        let host = UIHostingController(rootView: view.background(Color(uiColor: .systemBackground)))
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 844))
        window.rootViewController = host
        window.makeKeyAndVisible()
        let height = host.sizeThatFits(in: CGSize(width: width, height: .greatestFiniteMagnitude)).height
        host.view.frame = CGRect(x: 0, y: 0, width: width, height: max(height, 1))
        try? await Task.sleep(for: .milliseconds(400))
        host.view.layoutIfNeeded()
        let image = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        window.isHidden = true
        return image
    }

    /// How many distinct colours the picture holds, counted on a coarse grid of its pixels.
    static func colours(in image: UIImage) -> Int {
        guard let cg = image.cgImage else { return 0 }
        let w = cg.width, h = cg.height
        var pixels = [UInt8](repeating: 0, count: w * h * 4)
        guard
            let context = CGContext(
                data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return 0 }
        context.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        var seen = Set<UInt32>()
        for y in stride(from: 0, to: h, by: 2) {
            for x in stride(from: 0, to: w, by: 2) {
                let i = (y * w + x) * 4
                seen.insert(UInt32(pixels[i]) << 16 | UInt32(pixels[i + 1]) << 8 | UInt32(pixels[i + 2]))
            }
        }
        return seen.count
    }

    /// The precondition of every assertion on a render: there is a picture, and it is not one flat colour.
    private func assertDrawn(_ image: UIImage, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertGreaterThan(image.size.width, 0, "\(what): the picture has a width", file: file, line: line)
        XCTAssertGreaterThan(image.size.height, 1, "\(what): the picture has a height", file: file, line: line)
        XCTAssertGreaterThan(
            Self.colours(in: image), 1, "\(what): the picture is not one uniform colour", file: file, line: line)
    }

    private func attach(_ image: UIImage, _ name: String) {
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testAGroupedNotificationRowIsDrawnWithItsSentence() async {
        let notice = SocialNotification(
            notificationId: "n1", kind: .reaction, actor: anna, actors: [anna, jon], actorCount: 2,
            snippet: "Fundur á morgun", announce: false, communityId: "k1", postId: "p1", commentId: nil, action: nil,
            emoji: "👍", createdAt: FakeAccount.now, read: false)
        let sentence = noticeWording(notice).sentence
        XCTAssertTrue(sentence.contains("Anna") && sentence.contains("Jón"), "one sentence names both: \(sentence)")
        let image = await render(
            NoticeRow(
                notification: notice, community: makeCommunity("k1", "Kórinn"),
                model: NotificationsModel(social: FakeSocial())))
        assertDrawn(image, "grouped row")
        attach(image, "grouped-notification-row")
    }

    func testAnAnonymousCardIsDrawnWithoutAnAuthor() async {
        let post = makePost("p1", "k1", body: "Hver mætir?", author: nil, anonymous: true, own: false)
        XCTAssertEqual(anonymousByline(post), localized("post_anonymous_author"))
        let image = await render(
            PostCard(
                post: post, linked: false, writes: true, community: makeCommunity("k1", "Kórinn"), onReact: { _ in }))
        assertDrawn(image, "anonymous card")
        attach(image, "anonymous-post-card")
    }

    func testFacesAreDrawnAsAFortyFourPointTarget() async {
        let many = (1...6).map { person("a\($0)", "Nafn\($0)") }
        let image = await render(ReadFaces(people: many))
        assertDrawn(image, "faces")
        XCTAssertGreaterThanOrEqual(image.size.height, 44, "the row is a 44 pt target")
        attach(image, "read-faces")
    }

    func testAnImportedPostCarriesAMarkAndANativeOneDoesNot() async {
        func card(imported: Bool) -> PostCard {
            PostCard(post: makePost("p1", "k1", imported: imported), linked: false, writes: true, onReact: { _ in })
        }
        let native = await render(card(imported: false))
        let imported = await render(card(imported: true))
        assertDrawn(native, "native card")
        assertDrawn(imported, "imported card")
        XCTAssertGreaterThan(imported.size.height, native.size.height, "the mark takes a line")
        attach(imported, "imported-post-card")
    }

    /// The precondition can fail: a flat picture and an empty one are refused by the helper.
    func testAFlatPictureHasOneColour() {
        let flat = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 40)).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 40, height: 40))
        }
        XCTAssertEqual(Self.colours(in: flat), 1)
        XCTAssertEqual(Self.colours(in: UIImage()), 0)
    }
}
