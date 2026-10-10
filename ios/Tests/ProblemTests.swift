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
}
