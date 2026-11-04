package samtak.spjall.social

import samtak.spjall.core.Community
import samtak.spjall.core.CommunityInvitation
import samtak.spjall.core.JoinRequest

/**
 * The communities and the requests and invitations waiting in them (0070, 0130), in memory: answering one removes it
 * and brings the community's counts and flags along, as the server would.
 */
open class FakeSocialRequests :
    FakeSocialFriends(),
    SocialRequests {
    /** Every community, by id. */
    val communities = linkedMapOf<String, Community>()

    /** Each community's waiting join requests, oldest first. */
    val requests = mutableMapOf<String, MutableList<JoinRequest>>()

    /** Each community's pending invitations, oldest first. */
    val invitations = mutableMapOf<String, MutableList<CommunityInvitation>>()

    override fun joinRequests(communityId: String): List<JoinRequest> {
        call("joinRequests $communityId")
        return requests[communityId].orEmpty().toList()
    }

    override fun approveJoinRequest(
        communityId: String,
        accountId: String,
    ) {
        call("approveJoinRequest $communityId $accountId")
        answered(communityId, accountId)
    }

    override fun declineJoinRequest(
        communityId: String,
        accountId: String,
    ) {
        call("declineJoinRequest $communityId $accountId")
        answered(communityId, accountId)
    }

    private fun answered(
        communityId: String,
        accountId: String,
    ) {
        val list = requests[communityId] ?: throw notFound()
        if (!list.removeAll { it.accountId == accountId }) throw notFound()
        val community = communities.getValue(communityId)
        communities[communityId] = community.copy(pendingJoinRequests = list.size.toULong())
    }

    override fun communityInvitations(communityId: String): List<CommunityInvitation> {
        call("communityInvitations $communityId")
        return invitations[communityId].orEmpty().toList()
    }

    override fun withdrawInvitation(
        communityId: String,
        accountId: String,
    ) {
        call("withdrawInvitation $communityId $accountId")
        val list = invitations[communityId] ?: throw notFound()
        if (!list.removeAll { it.accountId == accountId }) throw notFound()
    }
}
