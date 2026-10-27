import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class NotificationLevelsModelTests: XCTestCase {
    private let social = FakeSocial()

    private func model() async -> NotificationLevelsModel {
        let model = NotificationLevelsModel(social: social)
        await model.load()
        return model
    }

    func testAnUnsetLevelIsPush() async {
        let model = await model()
        XCTAssertEqual(model.level(of: .comment), .push)
        XCTAssertEqual(model.level(ofCommunity: "c1"), .push)
    }

    func testAChangeCallsTheCoreAndShowsWhatIsStored() async {
        let model = await model()
        await model.set(.reaction, to: .inApp)
        XCTAssertTrue(social.calls.contains("setNotificationSettings reaction:inApp"))
        XCTAssertEqual(model.level(of: .reaction), .inApp)
        XCTAssertEqual(model.level(of: .comment), .push)
    }

    func testACommunityLevelCallsTheCore() async {
        let model = await model()
        await model.setCommunity("c1", to: .off)
        XCTAssertTrue(social.calls.contains("setCommunityNotificationLevel c1 off"))
        XCTAssertEqual(model.level(ofCommunity: "c1"), .off)
        XCTAssertEqual(model.communityLevels.map(\.communityId), ["c1"])
    }

    func testModeratorsActionsHaveAFloor() async {
        XCTAssertEqual(NotificationLevelsModel.choices(for: .moderated), [.push, .inApp])
        XCTAssertEqual(NotificationLevelsModel.choices(for: .comment), [.push, .inApp, .off])
        let model = await model()
        await model.set(.moderated, to: .off)
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("setNotificationSettings moderated") })
        XCTAssertEqual(model.level(of: .moderated), .push)
    }

    func testAFailedChangeKeepsTheLevelAndSaysSo() async {
        let model = await model()
        social.failOn = "setNotificationSettings"
        await model.set(.comment, to: .off)
        XCTAssertEqual(model.level(of: .comment), .push)
        XCTAssertNotNil(model.problem)
    }
}
