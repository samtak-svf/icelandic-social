import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class LinkModelTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)
    private let day: UInt64 = 86_400_000
    private let clock: UInt64 = 1_800_000_000_000

    /// A code is whatever starts with "code:", so no real code is needed here.
    private func model() -> LinkModel {
        let clock = clock
        return LinkModel(account: account, now: { clock }, isCode: { $0.hasPrefix("code:") })
    }

    private func inspected() async -> LinkModel {
        let model = model()
        await model.scanned("code:abc")
        return model
    }

    func testTextThatIsNotACodeNeverInspects() async {
        let model = model()
        await model.scanned("https://example.test")
        XCTAssertEqual(model.step, .scanning, "the camera goes on looking")
        model.paste()
        model.draft = "hello"
        await model.submitDraft()
        XCTAssertEqual(model.step, .error("device_link_invalid"))
        XCTAssertFalse(account.calls.contains { $0.hasPrefix("inspectLink") })
    }

    func testACodeShowsTheRequestToApprove() async {
        let model = await inspected()
        XCTAssertEqual(model.step, .approve(account.linkRequest))
        XCTAssertEqual(account.calls.last, "inspectLink code:abc")
    }

    func testAPastedCodeIsTrimmed() async {
        let model = model()
        model.paste()
        model.draft = "  code:abc\n"
        await model.submitDraft()
        XCTAssertEqual(account.calls.last, "inspectLink code:abc")
    }

    func testTheCoreErrorsMapToTheirKeys() async {
        let cases: [(CoreError, String)] = [
            (.LinkCodeInvalid, "device_link_invalid"),
            (.LinkKeyMismatch, "device_link_mismatch"),
            (.LinkExpired, "device_link_expired"),
            (.LinkAlreadyApproved, "device_link_already"),
        ]
        for (error, key) in cases {
            let model = model()
            account.failNext = error
            await model.scanned("code:abc")
            XCTAssertEqual(model.step, .error(key))
        }
    }

    func testARequestApprovedAlreadyIsAnError() async {
        account.linkRequest = LinkRequest(browser: nil, os: nil, expiresAt: 1, approved: true)
        let model = await inspected()
        XCTAssertEqual(model.step, .error("device_link_already"))
    }

    func testAFailureNoKeyNamesIsAProblem() async {
        account.failNext = unreachable
        let model = model()
        await model.scanned("code:abc")
        XCTAssertEqual(model.step, .problem(.unreachable))
    }

    func testRecentSendsTheLastNinetyDays() async {
        let model = await inspected()
        XCTAssertEqual(model.history, .recent, "the default")
        await model.approve()
        XCTAssertEqual(account.calls.last, "approveLink code:abc \(clock - 90 * day) true")
        XCTAssertEqual(model.step, .done)
    }

    func testAllSendsEverything() async {
        let model = await inspected()
        model.history = .all
        await model.approve()
        XCTAssertEqual(account.calls.last, "approveLink code:abc nil true")
    }

    func testNothingSendsNoHistory() async {
        let model = await inspected()
        model.history = .nothing
        await model.approve()
        XCTAssertEqual(account.calls.last, "approveLink code:abc nil false")
        XCTAssertEqual(model.step, .done)
    }

    func testAnApprovalTheServerRefusesIsAnError() async {
        let model = await inspected()
        account.failNext = CoreError.LinkExpired
        await model.approve()
        XCTAssertEqual(model.step, .error("device_link_expired"))
    }

    func testRestartingGoesBackToScanning() async {
        let model = model()
        account.failNext = CoreError.LinkExpired
        await model.scanned("code:abc")
        model.restart()
        XCTAssertEqual(model.step, .scanning)
    }

    func testTheLabelNamesTheBrowserOrSaysItIsUnknown() {
        XCTAssertEqual(
            LinkApproveView.label(LinkRequest(browser: nil, os: "Linux", expiresAt: 1, approved: false)),
            localized("session_browser_unknown"))
        XCTAssertEqual(
            LinkApproveView.label(LinkRequest(browser: "Firefox", os: "Linux", expiresAt: 1, approved: false)),
            localized("session_browser", "Firefox", "Linux"))
    }
}
