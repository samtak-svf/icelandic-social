import SpjallCore
import XCTest

@testable import Spjall

/// Join requests, a declined request, deleting a community, the verbs a report offers and the refusals a person
/// is told in their own words (decision 0070, #354 to #364).
@MainActor
final class JoinRequestsModelTests: XCTestCase {
    private let social = FakeSocial()

    private func request(_ id: String, _ name: String?) -> JoinRequest {
        JoinRequest(accountId: id, name: name, verified: false, requestedAt: FakeAccount.now)
    }

    private func model() async -> JoinRequestsModel {
        social.requests = ["k1": [request("a2", "Anna"), request("a3", nil)]]
        let model = JoinRequestsModel(social: social, communityId: "k1")
        await model.load()
        return model
    }

    func testListsTheRequestsThatWait() async {
        let model = await model()
        XCTAssertTrue(model.loaded)
        XCTAssertEqual(model.requests.map(\.accountId), ["a2", "a3"])
        XCTAssertTrue(social.calls.contains("joinRequests k1"))
    }

    func testApprovingARequestTakesItOffTheList() async {
        let model = await model()
        await model.approve(model.requests[0])
        XCTAssertTrue(social.calls.contains("approveJoinRequest k1 a2"))
        XCTAssertEqual(model.requests.map(\.accountId), ["a3"])
        XCTAssertNil(model.problem)
    }

    func testDecliningARequestTakesItOffTheList() async {
        let model = await model()
        await model.decline(model.requests[1])
        XCTAssertTrue(social.calls.contains("declineJoinRequest k1 a3"))
        XCTAssertEqual(model.requests.map(\.accountId), ["a2"])
    }

    func testARefusedAnswerKeepsTheRequestAndNamesTheProblem() async {
        let model = await model()
        social.failNext = CoreError.Refused(status: 403, code: "not_permitted", requestId: nil)
        await model.approve(model.requests[0])
        XCTAssertEqual(model.requests.count, 2)
        XCTAssertEqual(model.problem, .notPermitted)
    }
}

@MainActor
final class CommunityRoundBTests: XCTestCase {
    private let social = FakeSocial()

    private func model(_ community: Community) async -> CommunityModel {
        social.communities = [community.communityId: community]
        let model = CommunityModel(social: social, communityId: community.communityId, now: { FakeAccount.now })
        await model.load()
        return model
    }

    func testADeclinedRequestIsShownUntilItsDateHasPassed() async {
        var declined = makeCommunity("k1", "Fiskar", audience: .private)
        declined.joinDeclinedUntil = FakeAccount.now + 1_000
        let model = await model(declined)
        XCTAssertEqual(model.declinedUntil, FakeAccount.now + 1_000)
        var past = makeCommunity("k2", "Fuglar", audience: .private)
        past.joinDeclinedUntil = FakeAccount.now - 1
        let ended = await self.model(past)
        XCTAssertNil(ended.declinedUntil)
        let never = await self.model(makeCommunity("k3", "Ormar", audience: .private))
        XCTAssertNil(never.declinedUntil)
    }

    func testOnlyAModeratorCountsTheRequestsThatWait() async {
        var owned = makeCommunity("k1", "Fiskar", audience: .private, role: .owner)
        owned.pendingJoinRequests = 3
        let moderator = await model(owned)
        XCTAssertEqual(moderator.pendingRequests, 3)
        var member = makeCommunity("k2", "Fuglar", audience: .private, role: .member)
        member.pendingJoinRequests = 3
        let plain = await self.model(member)
        XCTAssertEqual(plain.pendingRequests, 0)
    }

    func testTheOwnerDeletesTheCommunity() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .owner))
        XCTAssertTrue(model.owns)
        await model.deleteCommunity()
        XCTAssertTrue(social.calls.contains("deleteCommunity k1"))
        XCTAssertTrue(model.deleted)
        XCTAssertNil(model.problem)
    }

    func testAMemberDoesNotDeleteTheCommunity() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .member))
        XCTAssertFalse(model.owns)
        await model.deleteCommunity()
        XCTAssertFalse(social.calls.contains("deleteCommunity k1"))
        XCTAssertFalse(model.deleted)
    }

    func testARefusedDeleteStaysOnTheScreen() async {
        let model = await model(makeCommunity("k1", "Fuglar", role: .owner))
        social.failNext = CoreError.Refused(status: 403, code: "not_permitted", requestId: nil)
        await model.deleteCommunity()
        XCTAssertFalse(model.deleted)
        XCTAssertEqual(model.problem, .notPermitted)
    }
}

final class OfferedVerbsTests: XCTestCase {
    private func report(state: TargetState?, standing: TargetStanding?, closed: Bool = false) -> Report {
        var report = makeReport("r1", in: "k1", .post, "p1", state: closed ? .closed : .open)
        report.targetState = state
        report.targetStanding = standing
        return report
    }

    func testAVisiblePostMayBeHiddenOrRemovedButNotRestored() {
        let verbs = offeredVerbs(report(state: .visible, standing: .member))
        XCTAssertTrue(verbs.isSuperset(of: [.hide, .remove, .mute, .ban, .dismiss]))
        XCTAssertFalse(verbs.contains(.restore))
        XCTAssertFalse(verbs.contains(.unmute))
        XCTAssertFalse(verbs.contains(.unban))
    }

    func testAHiddenPostMayBeRemovedOrRestoredAndAMutedAuthorUnmutedOrBanned() {
        let verbs = offeredVerbs(report(state: .hidden, standing: .muted))
        XCTAssertEqual(verbs, [.remove, .restore, .unmute, .ban, .dismiss])
    }

    func testARemovedPostMayOnlyBeRestoredAndABannedAuthorUnbanned() {
        let verbs = offeredVerbs(report(state: .removed, standing: .banned, closed: true))
        XCTAssertEqual(verbs, [.restore, .unban])
    }

    func testAGoneTargetOffersNothingAboutTheContentOrTheAuthor() {
        XCTAssertEqual(offeredVerbs(report(state: .gone, standing: .gone, closed: true)), [])
    }

    func testAStateTheServerDidNotGiveOffersEveryVerb() {
        let all = Set(ModerationVerb.allCases)
        XCTAssertEqual(offeredVerbs(report(state: nil, standing: nil)), all)
        XCTAssertEqual(offeredVerbs(report(state: .unknown, standing: .unknown)), all)
    }

    func testAnAuthorWhoLeftMayStillBeBanned() {
        let verbs = offeredVerbs(report(state: .visible, standing: .notMember))
        XCTAssertTrue(verbs.contains(.ban))
        XCTAssertFalse(verbs.contains(.mute))
    }
}

final class RefusalProblemTests: XCTestCase {
    private func refused(_ code: String) -> Problem {
        Problem(CoreError.Refused(status: 403, code: code, requestId: "req-1"))
    }

    func testTheNamedCodesBecomeTheirOwnProblems() {
        XCTAssertEqual(refused("not_permitted"), .notPermitted)
        XCTAssertEqual(refused("not_found"), .notFound)
        XCTAssertEqual(refused("join_declined"), .joinDeclined)
    }

    func testANamedProblemHasNoRetryAndNoRequestId() {
        for problem in [Problem.notPermitted, .notFound, .joinDeclined] {
            XCTAssertFalse(problem.canRetry)
            XCTAssertNil(problem.requestId)
            XCTAssertNil(ProblemCard.requestIdLine(problem))
        }
    }

    func testAnyOtherCodeStaysGeneric() {
        XCTAssertEqual(refused("blocked"), .generic(requestId: "req-1"))
    }
}
