package samtak.spjall.social

import samtak.spjall.core.CommunityInvitation
import samtak.spjall.core.CoreClient
import samtak.spjall.core.JoinRequest

/** The requests and invitations a community's moderators answer (0070, 0130), apart to keep each file under the cap. */
interface SocialRequests {
    /** The join requests that wait in a private community, oldest first; for its owner and moderators. */
    fun joinRequests(communityId: String): List<JoinRequest>

    /** Makes the account that asked a member. */
    fun approveJoinRequest(
        communityId: String,
        accountId: String,
    )

    /** Declines a request; the account may ask again after 30 days (decision 0070). */
    fun declineJoinRequest(
        communityId: String,
        accountId: String,
    )

    /** The invitations that wait, oldest first, each with who sent it; for the owner and moderators (0130). */
    fun communityInvitations(communityId: String): List<CommunityInvitation>

    /** Takes an invitation back; the notice the invited person got goes with it (0130). */
    fun withdrawInvitation(
        communityId: String,
        accountId: String,
    )
}

/** [SocialRequests] over the core's client. */
class CoreRequests(
    private val lazyClient: Lazy<CoreClient>,
) : SocialRequests {
    private val client by lazyClient

    override fun joinRequests(communityId: String) = client.joinRequests(communityId)

    override fun approveJoinRequest(
        communityId: String,
        accountId: String,
    ) = client.approveJoinRequest(communityId, accountId)

    override fun declineJoinRequest(
        communityId: String,
        accountId: String,
    ) = client.declineJoinRequest(communityId, accountId)

    override fun communityInvitations(communityId: String) = client.communityInvitations(communityId)

    override fun withdrawInvitation(
        communityId: String,
        accountId: String,
    ) = client.withdrawInvitation(communityId, accountId)
}
