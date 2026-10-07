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
        account.failNext = unreachable
        let model = await model()
        XCTAssertNil(model.me)
        await model.retry()
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
}
