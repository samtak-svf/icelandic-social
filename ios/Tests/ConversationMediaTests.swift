import Foundation
import SpjallCore
import XCTest

@testable import Spjall

/// Photos and files, the disappearing timer and block (step 10 of the conversation UI).
@MainActor
final class ConversationMediaTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)
    private lazy var live = FakeLive(account: account)
    private let sleeps = FakeSleep()
    private let pdf = item(3, content: .media(mime: "application/pdf", size: 10, caption: nil, name: "skýrsla.pdf"))

    private func model(members: [Person] = [person("a2", "Anna")]) async -> ConversationModel {
        account.list = [conversation("c1", members: members)]
        let model = ConversationModel(id: "c1", account: account, live: live, sleep: sleeps.sleep)
        await model.load()
        return model
    }

    private func copy(_ text: String) throws -> URL {
        let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try Data(text.utf8).write(to: file)
        return file
    }

    func testAFileOverTheLimitIsRefusedBeforeItIsRead() async {
        let model = await model()
        await model.attach(
            Picked(mime: "image/jpeg", size: ConversationModel.mediaLimit + 1) { throw CancellationError() })
        XCTAssertEqual(model.problem, .tooLarge)
        XCTAssertFalse(account.calls.contains { $0.hasPrefix("sendMedia") })
    }

    func testAPickedFileIsSentUnderItsNameAndItsCopyDeleted() async throws {
        let model = await model()
        let file = try copy("hello")
        await model.attach(Picked(mime: "image/jpeg", size: 5, name: "fjall.jpg") { file })
        XCTAssertTrue(account.calls.contains("sendMedia c1 image/jpeg fjall.jpg hello"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path), "the core keeps its own copy")
        XCTAssertNil(model.problem)
        XCTAssertEqual(account.calls.filter { $0 == "sync" }.count, 1, "the media message goes out")
    }

    func testAFailedSendIsAProblemThatRetryReadsAgain() async throws {
        let model = await model()
        let (first, second) = (try copy("one"), try copy("two"))
        let files = Files([first, second])
        account.failNext = unreachable
        await model.attach(Picked(mime: "application/pdf", size: nil) { files.next() })
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertFalse(FileManager.default.fileExists(atPath: first.path))
        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertTrue(account.calls.contains("sendMedia c1 application/pdf nil two"))
    }

    func testAFailedDownloadCanBeAskedForAgainAndAReadyOneIsKept() async {
        let model = await model()
        await model.fetch(pdf)
        XCTAssertEqual(model.media[3], .failed)
        account.files["c1 3"] = "/store/media/3"
        await model.fetch(pdf)
        XCTAssertEqual(model.media[3], .ready("/store/media/3"))
        await model.fetch(pdf)
        XCTAssertEqual(account.calls.filter { $0 == "media c1 3" }.count, 2)
    }

    func testOpeningAFileFetchesItAndHandsItOn() async {
        let model = await model()
        account.files["c1 3"] = "/store/media/3"
        await model.open(pdf)
        XCTAssertEqual(model.opened, .init(path: "/store/media/3", mime: "application/pdf", name: "skýrsla.pdf"))
        model.didOpen()
        XCTAssertNil(model.opened)
    }

    func testTheTimerIsSetAndTurnedOff() async {
        let model = await model()
        await model.timer(3_600)
        await model.timer(nil)
        XCTAssertEqual(
            account.calls.filter { $0.hasPrefix("send ") },
            ["send c1 \(Body.disappearing(seconds: 3_600))", "send c1 \(Body.disappearing(seconds: nil))"])
    }

    func testBlockingEndsTheOneToOne() async {
        let model = await model()
        await model.block()
        XCTAssertTrue(account.calls.contains("block a2"))
        XCTAssertEqual(account.blockedPeople.map(\.account), ["a2"])
    }

    func testAFailedBlockIsSaidAndCanBeTriedAgain() async {
        let model = await model()
        account.failNext = unreachable
        await model.block()
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertEqual(account.blockedPeople, [])
        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertEqual(account.blockedPeople.map(\.account), ["a2"])
    }

    func testAGroupHasNoOneToBlock() async {
        let model = await model(members: [person("a2", "Anna"), person("a3", "Bjarni")])
        await model.block()
        XCTAssertFalse(account.calls.contains { $0.hasPrefix("block") })
    }
}

/// Hands out one file per read.
private final class Files: @unchecked Sendable {
    private let lock = NSLock()
    private var files: [URL]

    init(_ files: [URL]) { self.files = files }

    func next() -> URL { lock.withLock { files.removeFirst() } }
}
