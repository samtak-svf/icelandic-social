import SpjallCore
import XCTest

@testable import Spjall

/// A moderator's invitation, as the phone shows and answers it (decision 0130).
@MainActor
final class InvitationsTests: XCTestCase {
    private let social = FakeSocial()
    private let by = InvitedBy(accountId: "a2", name: "Anna")

    private func model(_ community: Community) async -> CommunityModel {
        social.communities = [community.communityId: community]
        social.posts = [community.communityId: []]
        let model = CommunityModel(
            social: social, communityId: community.communityId, now: { FakeAccount.now }, sleep: { _ in })
        await model.load()
        return model
    }

    // MARK: the notice

    func testAnInvitationNoticeNamesItsInviterAndWearsTheInviteBadge() {
        let notice = makeNotice("n1", .communityInvite, actor: anna)
        let wording = noticeWording(notice)
        XCTAssertEqual(wording.key, "notice_community_invite")
        XCTAssertEqual(wording.badge, .invite)
        XCTAssertEqual(wording.sentence, localized("notice_community_invite", "Anna"))
    }

    func testADeletedInviterReadsAsADeletedAccount() {
        let wording = noticeWording(makeNotice("n1", .communityInvite))
        XCTAssertEqual(wording.args, .one(name: nil))
        XCTAssertEqual(wording.sentence, localized("notice_community_invite", localized("person_deleted")))
    }

    func testTwoInvitationsAreNeverGrouped() {
        let wording = noticeWording(kind: .communityInvite, names: ["Anna", "Bera"], actorCount: 2)
        XCTAssertEqual(wording.key, "notice_community_invite")
        XCTAssertEqual(wording.args, .one(name: "Anna"))
    }

    func testAnInvitationNoticeOpensTheCommunity() {
        XCTAssertEqual(noticeRoute(makeNotice("n1", .communityInvite, actor: anna)), .community("k1"))
        XCTAssertNil(noticeRoute(makeNotice("n2", .communityInvite, actor: anna, community: nil)))
    }

    func testAnInvitationTapOpensTheCommunity() {
        let model = PushModel(account: FakeAccount(signedIn: true), notifier: FakeNotifier())
        model.tapped(thread: "n1", community: "k1", post: nil, notice: "n1")
        XCTAssertEqual(model.takeOpenedSocial(), SocialTap(post: nil, community: "k1"))
        XCTAssertNil(model.takeOpened())
    }

    func testTheLevelsOfferTheInvitationKind() {
        XCTAssertTrue(NotificationLevelsModel.kinds.contains(.communityInvite))
        XCTAssertEqual(kindLabel(.communityInvite), localized("notification_kind_community_invite"))
    }

    // MARK: the invited person

    func testAnInvitedCommunityNamesTheInviter() async {
        let model = await model(makeCommunity("k1", "Fiskar", audience: .private, invited: true, invitedBy: by))
        XCTAssertEqual(model.community?.invited, true)
        XCTAssertEqual(invitationText(model.community!), localized("community_invited_by", "Anna"))
    }

    func testADeletedInviterReadsAsADeletedAccountAndNoInviterIsOnlyAnInvitation() async {
        let nameless = InvitedBy(accountId: "a9", name: nil)
        let gone = makeCommunity("k1", "Fiskar", audience: .private, invited: true, invitedBy: nameless)
        XCTAssertEqual(invitationText(gone), localized("community_invited_by", localized("person_deleted")))
        let older = makeCommunity("k1", "Fiskar", audience: .private, invited: true)
        XCTAssertEqual(invitationText(older), localized("community_invited"))
    }

    func testAcceptingCallsJoinAndMakesAMemberOfAPrivateCommunity() async {
        let model = await model(makeCommunity("k1", "Fiskar", audience: .private, invited: true, invitedBy: by))
        await model.join()
        XCTAssertTrue(social.calls.contains("joinCommunity k1"))
        XCTAssertEqual(model.community?.role, .member)
        XCTAssertEqual(model.community?.invited, false)
    }

    func testDecliningCallsWithdrawAndEndsTheInvitation() async {
        let model = await model(makeCommunity("k1", "Fiskar", audience: .private, invited: true, invitedBy: by))
        await model.withdraw()
        XCTAssertTrue(social.calls.contains("withdrawJoinRequest k1"))
        XCTAssertNil(model.community?.role)
        XCTAssertEqual(model.community?.invited, false)
        XCTAssertNil(model.community?.invitedBy)
    }

    // MARK: the moderator's list

    private func invitation(_ account: String, _ name: String?, by: InvitedBy? = nil) -> CommunityInvitation {
        CommunityInvitation(accountId: account, name: name, invitedBy: by, createdAt: FakeAccount.now)
    }

    func testTheInvitationsLoadBesideTheRequests() async {
        social.invitations = ["k1": [invitation("a5", "Bera", by: by), invitation("a6", nil)]]
        let model = JoinRequestsModel(social: social, communityId: "k1")
        await model.load()
        XCTAssertEqual(model.invitations.map(\.accountId), ["a5", "a6"])
        XCTAssertEqual(model.invitations.first?.invitedBy?.name, "Anna")
        XCTAssertTrue(social.calls.contains("communityInvitations k1"))
    }

    func testWithdrawingCallsTheCallAndAsksForTheListAgain() async {
        social.invitations = ["k1": [invitation("a5", "Bera"), invitation("a6", "Dóra")]]
        let model = JoinRequestsModel(social: social, communityId: "k1")
        await model.load()
        let first = model.invitations[0]
        await model.withdraw(first)
        XCTAssertEqual(
            social.calls.suffix(2), ["withdrawInvitation k1 a5", "communityInvitations k1"])
        XCTAssertEqual(model.invitations.map(\.accountId), ["a6"])
        XCTAssertNil(model.problem)
    }

    func testNoInvitationsLeavesTheListEmpty() async {
        let model = JoinRequestsModel(social: social, communityId: "k1")
        await model.load()
        XCTAssertTrue(model.invitations.isEmpty)
        XCTAssertTrue(model.loaded)
    }
}
