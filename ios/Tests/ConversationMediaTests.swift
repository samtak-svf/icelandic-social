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

    private func exists(_ file: URL) -> Bool { FileManager.default.fileExists(atPath: file.path) }

    /// A photo picked, waiting above the field.
    private func picked(_ model: ConversationModel, _ text: String = "hello") async throws -> URL {
        let file = try copy(text)
        await model.pick(Picked(mime: "image/jpeg", size: Int64(text.utf8.count), name: "fjall.jpg") { file })
        return file
    }

    func testAFileOverTheLimitIsRefusedBeforeItIsRead() async {
        let model = await model()
        await model.pick(
            Picked(mime: "image/jpeg", size: ConversationModel.mediaLimit + 1) { throw CancellationError() })
        XCTAssertEqual(model.problem, .tooLarge)
        XCTAssertNil(model.attachment)
    }

    func testAPickedPhotoWaitsAndIsNotSent() async throws {
        let model = await model()
        let file = try await picked(model)
        XCTAssertFalse(account.calls.contains { $0.hasPrefix("sendMedia") })
        XCTAssertEqual(model.attachment, .init(path: file.path, mime: "image/jpeg", name: "fjall.jpg"))
        XCTAssertTrue(model.sendable, "send replaces attach")
        XCTAssertEqual(model.composerAction, .send)
    }

    func testSendSendsTheAttachmentWithTheDraftAsItsCaption() async throws {
        let model = await model()
        let file = try await picked(model)
        model.type("  Esja í morgun ")
        await model.send()
        XCTAssertTrue(account.calls.contains("sendMedia c1 image/jpeg fjall.jpg Esja í morgun hello"))
        XCTAssertFalse(account.calls.contains { $0.hasPrefix("send c1") }, "nothing goes as a text of its own")
        XCTAssertFalse(exists(file), "the core keeps its own copy")
        XCTAssertNil(model.attachment)
        XCTAssertEqual(model.draft, "")
        XCTAssertEqual(account.calls.filter { $0 == "sync" }.count, 1, "the media message goes out")
    }

    func testAnEmptyFieldSendsNoCaption() async throws {
        let model = await model()
        _ = try await picked(model)
        await model.send()
        XCTAssertTrue(account.calls.contains("sendMedia c1 image/jpeg fjall.jpg nil hello"))
    }

    func testRemovingTheAttachmentDeletesItAndSendsNothing() async throws {
        let model = await model()
        let file = try await picked(model)
        model.removeAttachment()
        XCTAssertNil(model.attachment)
        XCTAssertFalse(exists(file))
        XCTAssertFalse(account.calls.contains { $0.hasPrefix("sendMedia") })
        XCTAssertEqual(model.composerAction, .attach)
    }

    func testASecondPickReplacesTheFirst() async throws {
        let model = await model()
        let first = try await picked(model, "first")
        let second = try await picked(model, "second")
        XCTAssertFalse(exists(first))
        XCTAssertEqual(model.attachment?.path, second.path)
    }

    func testReplyingOrEditingRemovesAWaitingAttachment() async throws {
        let model = await model()
        let first = try await picked(model)
        model.reply(item(4))
        XCTAssertNil(model.attachment)
        XCTAssertFalse(exists(first))
        let second = try await picked(model)
        model.cancelMode()
        model.edit(item(5, own: true))
        XCTAssertNil(model.attachment)
        XCTAssertFalse(exists(second))
    }

    func testAFailedSendKeepsTheAttachmentAndCaptionToTryAgain() async throws {
        let model = await model()
        let file = try await picked(model)
        model.type("Esja")
        account.failOn = "sendMedia c1 image/jpeg fjall.jpg Esja hello"
        await model.send()
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertEqual(model.attachment?.path, file.path)
        XCTAssertTrue(exists(file))
        XCTAssertEqual(model.draft, "Esja")
        account.failOn = nil
        await model.retry()
        XCTAssertNil(model.attachment)
        XCTAssertEqual(account.calls.filter { $0.hasPrefix("sendMedia") }.count, 2)
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
