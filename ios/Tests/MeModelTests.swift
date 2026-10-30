import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class MeModelTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)

    private func model() async -> MeModel {
        let model = MeModel(account: account)
        await model.load()
        return model
    }

    func testShowsThePersonTheirDevicesAndNoLinkUntilAskedForOne() async {
        let model = await model()
        XCTAssertEqual(model.me?.name, "Jón Jónsson")
        XCTAssertEqual(model.me?.devices.map(\.deviceId), ["d1", "d2"])
        XCTAssertNil(model.link)
        XCTAssertFalse(account.calls.contains("rotateInvite"), "opening the screen must not end a shared link")
    }

    func testShowsTheLinkThisDeviceMadeBefore() async {
        account.link = "https://link.test/l/old"
        let link = await model().link
        XCTAssertEqual(link, "https://link.test/l/old")
    }

    func testANewLinkReplacesTheOldOne() async {
        let model = await model()
        await model.newLink()
        XCTAssertEqual(model.link, "https://link.test/l/1")
        await model.newLink()
        XCTAssertEqual(model.link, "https://link.test/l/2")
    }

    func testRevokingAnotherDeviceRefreshesTheList() async {
        let model = await model()
        await model.revoke(deviceId: "d2")
        XCTAssertEqual(model.me?.devices.map(\.deviceId), ["d1"])
        XCTAssertFalse(model.signedOut)
    }

    func testRevokingThisDeviceSignsOut() async {
        let model = await model()
        await model.revoke(deviceId: "d1")
        XCTAssertTrue(model.signedOut)
        XCTAssertEqual(account.calls.last, "revokeDevice d1")
    }

    func testSigningOutRevokesThisDevice() async {
        let model = await model()
        await model.signOut()
        XCTAssertTrue(model.signedOut)
        XCTAssertEqual(account.calls.last, "revokeDevice d1", "the same as revoking this device was")
    }

    func testOnlyTheOtherDevicesOfferToBeRevoked() async {
        let model = await model()
        let devices = model.me?.devices ?? []
        XCTAssertEqual(devices.filter(MeModel.revocable).map(\.deviceId), ["d2"], "this one signs out instead")
    }

    func testDeletingTheAccountSignsOut() async {
        let model = await model()
        await model.deleteAccount()
        XCTAssertTrue(model.signedOut)
    }

    func testAFailedActionCanBeTriedAgain() async {
        let model = await model()
        account.failNext = unreachable
        await model.deleteAccount()
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertFalse(model.signedOut)

        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertTrue(model.signedOut)
    }

    func testAFailedFirstLoadCanBeTriedAgain() async {
        // The load asks three things at once and any of them may meet the failure, so
        // `me` may already be there: the failure is what this test can rely on.
        account.failNext = unreachable
        let model = await model()
        XCTAssertNotNil(model.problem)
        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertEqual(model.me?.accountId, "a1")
    }

    func testTheTogglesAreShownAndChanged() async {
        let model = await model()
        XCTAssertEqual(model.settings, Settings(readMarkers: true, typing: true))
        await model.readMarkers(false)
        await model.typing(false)
        XCTAssertEqual(model.settings, Settings(readMarkers: false, typing: false))
        XCTAssertEqual(account.current, Settings(readMarkers: false, typing: false))
    }

    func testTheBlockedAreListedAndCanBeUnblocked() async {
        account.blockedPeople = [person("a3", "Bjarni"), person("a2", "Anna")]
        let model = await model()
        XCTAssertEqual(model.blocked.map(\.account), ["a3", "a2"])
        await model.unblock("a3")
        XCTAssertEqual(model.blocked.map(\.account), ["a2"])
        XCTAssertTrue(account.calls.contains("unblock a3"))
    }

    func testAChosenPhotoIsUploadedShownAndItsFileDeleted() async {
        let model = await model()
        let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".jpg")
        await model.setPhoto { try pick(file) }
        XCTAssertEqual(account.uploaded, [Data("jpeg".utf8)])
        XCTAssertEqual(model.me?.photo, "v1")
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path), "the small copy must not stay behind")
    }

    func testAFailedUploadDeletesTheFileAndCanBeTriedAgain() async {
        let model = await model()
        let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".jpg")
        account.failNext = unreachable
        await model.setPhoto { try pick(file) }
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertNil(model.me?.photo)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))

        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertEqual(model.me?.photo, "v1")
        XCTAssertEqual(account.uploaded, [Data("jpeg".utf8)], "trying again makes the file again from the pick")
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    func testSavingTheFramingOfAChosenPhotoSendsItAfterTheUpload() async {
        let model = await model()
        let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".jpg")
        let framing = Framing(focus: Focus(x: 0.3, y: 0.4), overrides: [])
        await model.setPhoto({ try pick(file) }, framing: framing)
        XCTAssertEqual(account.calls.filter { $0.hasPrefix("setPhoto") }, ["setPhoto", "setPhotoFraming"])
        XCTAssertEqual(account.framings, [framing])
    }

    func testReframingTheOwnPhotoSendsOnlyTheFraming() async {
        let model = await model()
        let framing = Framing(focus: Focus(x: 0.6, y: 0.5), overrides: [])
        await model.reframePhoto(framing)
        XCTAssertEqual(account.framings, [framing])
        XCTAssertFalse(account.calls.contains("setPhoto"), "no new upload")
    }

    func testThePhotoMasterComesWithItsStoredFraming() async throws {
        let stored = Framing(focus: Focus(x: 0.1, y: 0.9), overrides: [])
        account.storedFraming = stored
        let model = await model()
        let master = await model.photoMaster()
        let found = try XCTUnwrap(master)
        defer { try? FileManager.default.removeItem(at: found.file) }
        XCTAssertEqual(found.framing, stored)
    }

    func testAPhotoSetBeforeMastersWereKeptShowsNoSheetAndTheNoMasterProblem() async {
        account.hasMaster = false
        let model = await model()
        let found = await model.photoMaster()
        XCTAssertNil(found)
        XCTAssertEqual(model.problem, .noMaster)
    }

    func testAPickThatIsNotAPhotoIsAProblemNotACrash() async {
        let model = await model()
        await model.setPhoto { throw CocoaError(.fileReadCorruptFile) }
        XCTAssertEqual(model.problem, .generic())
        XCTAssertFalse(account.calls.contains("setPhoto"))
    }

    func testRemovingThePhotoClearsIt() async {
        account.myPhoto = "v7"
        let model = await model()
        XCTAssertEqual(model.me?.photo, "v7")
        await model.removePhoto()
        XCTAssertNil(model.me?.photo)
        XCTAssertEqual(account.calls.last, "me")
        XCTAssertTrue(account.calls.contains("removePhoto"))
    }
}

/// Stands in for the picked photo made small and square: writes it to `file`.
private func pick(_ file: URL) throws -> URL {
    try Data("jpeg".utf8).write(to: file)
    return file
}
