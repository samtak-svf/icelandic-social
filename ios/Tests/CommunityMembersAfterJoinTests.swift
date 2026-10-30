import SpjallCore
import XCTest

@testable import Spjall

/// The member list follows the account's own join and leave, not the screen's next recreation.
@MainActor
final class CommunityMembersAfterJoinTests: XCTestCase {
    private let social = FakeSocial()

    func testTheMemberListIsCurrentAfterJoiningAndLeaving() async {
        let community = makeCommunity("k1", "Fuglar", role: .member)
        social.communities = ["k1": community]
        social.posts = ["k1": []]
        social.members = ["k1": [makeMember("a2", "Anna")]]
        let model = CommunityModel(social: social, communityId: "k1", now: { FakeAccount.now }, sleep: { _ in })
        await model.load()
        await model.loadMembers()
        XCTAssertEqual(model.members.map(\.accountId), ["a2"])
        social.members = ["k1": [makeMember("a2", "Anna"), makeMember("a3", "Bára")]]
        await model.join()
        XCTAssertEqual(model.members.map(\.accountId), ["a2", "a3"])
        social.members = ["k1": [makeMember("a3", "Bára")]]
        await model.leave()
        XCTAssertEqual(model.members.map(\.accountId), ["a3"])
        XCTAssertNil(model.problem)
    }
}
