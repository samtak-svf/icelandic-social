import Foundation
import SpjallCore
import XCTest

/// The core's client from Swift, as the app will call it (decisions 0018
/// and 0019): two devices, each with its own store and a Swift `Transport`,
/// sign in and exchange a message and a sealed file (0023).
final class CoreClientTests: XCTestCase {
    private let relay = Relay()
    private var dirs: [URL] = []

    override func tearDown() {
        for dir in dirs { try? FileManager.default.removeItem(at: dir) }
    }

    private func phone(account: String, device: String) throws -> CoreClient {
        let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        dirs.append(dir)
        let client = try CoreClient.open(
            dir: dir.path(percentEncoded: false),
            key: Data(repeating: 7, count: 32),
            transport: relay.link(account: account, device: device)
        )
        XCTAssertNil(try client.signedIn())
        // The app opens this URL in ASWebAuthenticationSession and is handed the callback.
        let callback = Relay.kenni(try client.beginSignIn())
        let signedIn = SignedIn(accountId: account, deviceId: device)
        XCTAssertEqual(try client.completeSignIn(callback: callback, inviteToken: nil, platform: .ios), signedIn)
        XCTAssertEqual(try client.signedIn(), signedIn)
        XCTAssertEqual(try client.deviceToken(), "token-\(device)")
        XCTAssertEqual(try client.stockKeyPackages(target: 2), 2)
        return client
    }

    private func deliver(_ client: CoreClient, device: String) throws -> [Event] {
        try relay.frames(device: device).flatMap { try client.onFrame(frame: $0).events }.filter {
            switch $0 {
            case .timeline, .profiles: false
            default: true
            }
        }
    }

    private func conversation(_ a: CoreClient, _ b: CoreClient) throws -> String {
        let conversation = try a.createConversation(with: ["b"])
        _ = try a.sync()
        XCTAssertEqual(try deliver(b, device: "b1"), [.joined(conversation: conversation)])
        return conversation
    }

    func testTwoDevicesExchangeAMessage() throws {
        let a = try phone(account: "a", device: "a1")
        let b = try phone(account: "b", device: "b1")
        let conversation = try conversation(a, b)

        let id = try a.send(conversation: conversation, body: .text(text: "halló"))
        _ = try a.sync()
        let events = try deliver(b, device: "b1")
        guard events.count == 1, case .message(let message) = events[0] else {
            return XCTFail("\(events)")
        }
        XCTAssertEqual(message.envelope.id, id)
        XCTAssertEqual(message.envelope.body, .text(text: "halló"))
        XCTAssertEqual(message.senderAccount, "a")
        XCTAssertEqual(message.senderDevice, "a1")
        let history = try b.history(conversation: conversation, before: nil, limit: 10)
        XCTAssertTrue(history.contains { $0.envelope.id == id })
    }

    func testAFileCrossesSealedAndOpensOnTheOtherSide() throws {
        let a = try phone(account: "a", device: "a1")
        let b = try phone(account: "b", device: "b1")
        let conversation = try conversation(a, b)
        let photo = Data((0..<70_000).map { UInt8($0 % 251) })
        let file = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString).png")
        try photo.write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }

        _ = try a.sendMedia(
            conversation: conversation, path: file.path(percentEncoded: false), mime: "image/png", caption: "sólarlag",
            name: "../sólarlag.png")
        _ = try a.sync()
        _ = try deliver(b, device: "b1")
        let items = try b.timeline(conversation: conversation, before: nil, limit: 10)
        let item = try XCTUnwrap(
            items.first {
                if case .media = $0.content { true } else { false }
            })
        guard case .media(let mime, let size, let caption, let name) = item.content else { return XCTFail("\(item)") }
        XCTAssertEqual(mime, "image/png")
        XCTAssertEqual(size, UInt64(photo.count))
        XCTAssertEqual(caption, "sólarlag")
        XCTAssertEqual(name, "sólarlag.png", "the core cuts the name to a bare one")
        let opened = try b.media(conversation: conversation, seq: try XCTUnwrap(item.seq))
        XCTAssertEqual(try Data(contentsOf: URL(filePath: opened)), photo)
    }
}
