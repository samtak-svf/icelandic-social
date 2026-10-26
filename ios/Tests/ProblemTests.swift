import SpjallCore
import XCTest

@testable import Spjall

/// A refusal keeps the server's request id (decision 0037), and the card names it; nothing else invents one.
final class ProblemTests: XCTestCase {
    func testARefusalKeepsTheRequestId() {
        let refused = Problem(CoreError.Refused(status: 403, code: "blocked", requestId: "req-1"))
        XCTAssertEqual(refused, .generic(requestId: "req-1"))
        let taken = Problem(CoreError.Refused(status: 409, code: "identity_taken", requestId: "req-2"))
        XCTAssertEqual(taken, .identityTaken(requestId: "req-2"))
        XCTAssertFalse(taken.canRetry)
    }

    func testTheCardNamesTheRequestIdOnlyWhenThereIsOne() {
        let line = ProblemCard.requestIdLine(.generic(requestId: "req-7f3a"))
        XCTAssertEqual(line, localized("problem_request_id", "req-7f3a"))
        XCTAssertTrue(line?.contains("req-7f3a") ?? false)
        XCTAssertNil(ProblemCard.requestIdLine(.generic()))
        let older = CoreError.Refused(status: 500, code: "internal", requestId: nil)
        XCTAssertNil(ProblemCard.requestIdLine(Problem(older)))
        XCTAssertNil(ProblemCard.requestIdLine(.unreachable))
        XCTAssertNil(ProblemCard.requestIdLine(Problem(CoreError.Unreachable(detail: "timeout"))))
    }

    func testALocalFailureNamesTheCoresCode() {
        let problem = Problem(CoreError.Store(detail: "ConstraintViolation/2067"))
        XCTAssertEqual(problem, .generic(code: "store/ConstraintViolation/2067"))
        XCTAssertEqual(ProblemCard.codeLine(problem), localized("problem_local_code", "store/ConstraintViolation/2067"))
        XCTAssertNil(Problem(CoreError.Refused(status: 403, code: "blocked", requestId: "req-1")).code)
        XCTAssertNil(ProblemCard.codeLine(.unreachable))
    }

    func testTheSocialRefusalsHaveTheirOwnProblems() {
        let full = Problem(CoreError.Refused(status: 409, code: "pin_limit", requestId: "r"))
        XCTAssertEqual(full, .pinFull)
        XCTAssertEqual(Problem(CoreError.Refused(status: 409, code: "anonymous_off", requestId: nil)), .anonymousOff)
        XCTAssertEqual(Problem(CoreError.Refused(status: 409, code: "poll_closed", requestId: nil)), .pollClosed)
        XCTAssertFalse(full.canRetry)
        XCTAssertNil(ProblemCard.requestIdLine(full))
    }

    /// A browser linked from a session is named so in the device list (#155); a phone names its platform.
    func testTheDeviceListNamesAWebDevice() {
        let web = AccountDevice(deviceId: "w", platform: .android, kind: .web, createdAt: 1, current: false)
        XCTAssertEqual(deviceTitle(web), localized("device_kind_web"))
        let phone = AccountDevice(deviceId: "p", platform: .ios, kind: .phone, createdAt: 1, current: true)
        XCTAssertEqual(deviceTitle(phone), "iPhone")
    }

    /// A browser shows a globe and a phone a phone, whatever platform the browser reports.
    func testTheDeviceListDrawsAGlobeForAWebDevice() {
        let web = AccountDevice(deviceId: "w", platform: .ios, kind: .web, createdAt: 1, current: false)
        XCTAssertEqual(deviceSymbol(web), "globe")
        let phone = AccountDevice(deviceId: "p", platform: .android, kind: .phone, createdAt: 1, current: false)
        XCTAssertEqual(deviceSymbol(phone), "iphone")
    }
}
