import SpjallCore
import XCTest

@testable import Spjall

/// The friend lists and the person screen (decision 0114), against the fake server.
@MainActor
final class FriendsTests: XCTestCase {
    private let social = FakeSocial()
    private let bera = Author(accountId: "b1", name: "Bera", verified: false)
    private let agust = Author(accountId: "b2", name: "Ágúst", verified: true)
    private let cecil = Author(accountId: "b3", name: "Cecil", verified: false)

    private func friends() async -> FriendsModel {
        let model = FriendsModel(social: social)
        await model.load()
        return model
    }

    private func person(_ author: Author) async -> PersonModel {
        let model = PersonModel(social: social, accountId: author.accountId)
        await model.load()
        return model
    }

    func testTheListsLoadTogether() async {
        social.know(bera, as: .friends)
        social.know(agust, as: .incoming)
        social.know(cecil, as: .sent)
        let model = await friends()
        XCTAssertTrue(model.loaded)
        XCTAssertEqual(model.page?.friends.map(\.person.accountId), ["b1"])
        XCTAssertEqual(model.requests.incoming.map(\.person.accountId), ["b2"])
        XCTAssertEqual(model.requests.sent.map(\.person.accountId), ["b3"])
    }

    func testTheSortAndTheSearchAskTheServerAgain() async {
        social.know(bera, as: .friends)
        social.know(agust, as: .friends)
        let model = await friends()
        XCTAssertEqual(model.page?.friends.count, 2)
        await model.choose(.name)
        XCTAssertTrue(social.calls.contains("friends name -"))
        await model.search("  Ber ")
        XCTAssertTrue(social.calls.contains("friends name Ber"))
        XCTAssertEqual(model.page?.friends.map(\.person.accountId), ["b1"])
        XCTAssertTrue(model.searched)
        await model.search("")
        XCTAssertFalse(model.searched)
    }

    func testAnAnswerReadsTheListsAgain() async {
        social.know(agust, as: .incoming)
        social.know(cecil, as: .incoming)
        social.know(bera, as: .sent)
        let model = await friends()
        await model.accept("b2")
        XCTAssertEqual(model.page?.friends.map(\.person.accountId), ["b2"])
        await model.decline("b3")
        XCTAssertTrue(model.requests.incoming.isEmpty)
        await model.cancel("b1")
        XCTAssertTrue(model.requests.sent.isEmpty)
    }

    func testAnUnsnoozeLeavesTheList() async throws {
        social.know(bera, as: .friends)
        _ = try social.snoozePerson("b1")
        let model = await friends()
        XCTAssertEqual(model.snoozes.map(\.person.accountId), ["b1"])
        await model.unsnooze("b1")
        XCTAssertTrue(model.snoozes.isEmpty)
    }

    func testAFailedAnswerKeepsTheListsAndRetries() async {
        social.know(agust, as: .incoming)
        let model = await friends()
        social.failOn = "acceptFriendRequest"
        await model.accept("b2")
        XCTAssertNotNil(model.problem)
        XCTAssertEqual(model.requests.incoming.count, 1)
        social.failOn = nil
        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertTrue(model.requests.incoming.isEmpty)
    }

    func testEachRelationOffersItsOwnActions() {
        XCTAssertEqual(relationOffer(.none).actions, [.add])
        XCTAssertEqual(relationOffer(.sent).actions, [.cancel])
        XCTAssertEqual(relationOffer(.incoming).actions, [.accept, .decline])
        XCTAssertEqual(relationOffer(.friends).actions, [])
        XCTAssertEqual(relationOffer(.oneself).actions, [])
        XCTAssertEqual(relationOffer(.unknown).actions, [])
        XCTAssertEqual(relationOffer(.sent).sentence, "person_request_sent")
        XCTAssertEqual(relationOffer(.incoming).sentence, "person_answer_request")
    }

    func testTheActionsMoveThePersonThroughTheirRelations() async {
        social.know(bera, as: .none)
        let model = await person(bera)
        XCTAssertEqual(model.person?.relation, Relation.none)
        await model.perform(.add)
        XCTAssertEqual(model.person?.relation, .sent)
        await model.perform(.cancel)
        XCTAssertEqual(model.person?.relation, Relation.none)
    }

    func testAcceptingAndDecliningAnIncomingRequest() async {
        social.know(agust, as: .incoming)
        social.know(cecil, as: .incoming)
        let accepted = await person(agust)
        XCTAssertEqual(accepted.person?.relation, .incoming)
        await accepted.perform(.accept)
        XCTAssertEqual(accepted.person?.relation, .friends)
        let declined = await person(cecil)
        await declined.perform(.decline)
        XCTAssertEqual(declined.person?.relation, Relation.none)
    }

    func testAskingBackWhenTheyAskedFirstMakesFriends() async {
        social.know(agust, as: .incoming)
        let model = await person(agust)
        await model.perform(.add)
        XCTAssertEqual(model.person?.relation, .friends)
    }

    func testEndingASnoozeAndItsUndo() async {
        social.know(bera, as: .friends)
        let model = await person(bera)
        await model.snooze()
        XCTAssertEqual(model.person?.snoozedUntil, 99)
        await model.unsnooze()
        XCTAssertNil(model.person?.snoozedUntil)
        await model.end()
        XCTAssertEqual(model.person?.relation, Relation.none)
        XCTAssertNil(model.person?.friendsSince)
    }

    func testAFailedActionKeepsThePersonAndRetriesIt() async {
        social.know(bera, as: .none)
        let model = await person(bera)
        social.failOn = "sendFriendRequest"
        await model.perform(.add)
        XCTAssertNotNil(model.problem)
        XCTAssertEqual(model.person?.relation, Relation.none)
        social.failOn = nil
        await model.retry()
        XCTAssertEqual(model.person?.relation, .sent)
    }

    func testAFriendNoticeOpensThePersonWhoMadeIt() {
        let request = makeNotice("n1", .friendRequest, actor: bera, community: nil)
        XCTAssertEqual(noticeRoute(request), .person("b1"))
        XCTAssertEqual(noticeRoute(makeNotice("n2", .friendAccepted, actor: bera, community: nil)), .person("b1"))
        XCTAssertNil(noticeRoute(makeNotice("n3", .friendRequest, community: nil)))
        let wording = noticeWording(request)
        XCTAssertEqual(wording.key, "notice_friend_request")
        XCTAssertEqual(wording.badge, .friend)
        XCTAssertEqual(noticeWording(makeNotice("n2", .friendAccepted, actor: bera)).key, "notice_friend_accepted")
    }

    func testTheBioAndCoverClearingsHaveTheirOwnWords() {
        func key(_ action: NotificationAction) -> String {
            noticeWording(kind: .moderated, names: [], actorCount: 0, action: action).key
        }
        XCTAssertEqual(key(.clearAccountBio), "notice_account_bio_cleared")
        XCTAssertEqual(key(.clearAccountCover), "notice_account_cover_cleared")
        XCTAssertEqual(statementLabel(.clearAccountBio), localized("moderation_decision_clear_account_bio"))
        XCTAssertEqual(statementLabel(.clearAccountCover), localized("moderation_decision_clear_account_cover"))
        XCTAssertEqual(statementLabel(.readReported), localized("moderation_decision_read_reported"))
        XCTAssertNil(logActionLabel(.readReported))
    }

    func testTheFriendRefusalsAreTheirOwnProblems() {
        func problem(_ status: UInt16, _ code: String) -> Problem {
            Problem(CoreError.Refused(status: status, code: code, requestId: nil))
        }
        XCTAssertEqual(problem(409, "request_refused"), .requestRefused)
        XCTAssertEqual(problem(429, "request_limit"), .requestLimit)
        XCTAssertEqual(problem(409, "friend_limit"), .friendLimit)
        XCTAssertFalse(Problem.friendLimit.canRetry)
    }

    func testTheLevelsListEveryKindIncludingTheFriendOnes() async {
        let model = NotificationLevelsModel(social: social)
        await model.load()
        XCTAssertEqual(NotificationLevelsModel.kinds.count, 7)
        XCTAssertTrue(NotificationLevelsModel.kinds.contains(.friendRequest))
        XCTAssertTrue(NotificationLevelsModel.kinds.contains(.friendAccepted))
    }
}
