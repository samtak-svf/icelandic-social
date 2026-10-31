package samtak.spjall.social

import samtak.spjall.core.CoreClient
import samtak.spjall.core.FriendPage
import samtak.spjall.core.FriendRequests
import samtak.spjall.core.FriendSort
import samtak.spjall.core.PersonProfile
import samtak.spjall.core.Relation
import samtak.spjall.core.Snooze

/** The friend calls of [Social] (decision 0114), apart so each file stays under the cap. */
interface SocialFriends {
    /** An account as this one sees it; `Refused` 404 for none, or when a block stands between them. */
    fun person(accountId: String): PersonProfile

    /** This account's friends, those whose name matches [query] when there is one, and how many it has. */
    fun friends(
        sort: FriendSort,
        query: String?,
    ): FriendPage

    /** The requests waiting for this account's answer, and those it sent. */
    fun friendRequests(): FriendRequests

    /** Asks an account to be friends: [Relation.SENT], or [Relation.FRIENDS] when it had already asked. */
    fun sendFriendRequest(accountId: String): Relation

    /** Takes back a request this account sent. */
    fun cancelFriendRequest(accountId: String)

    /** Says yes to a request. */
    fun acceptFriendRequest(accountId: String)

    /** Says no to a request; the one who asked is not told. */
    fun declineFriendRequest(accountId: String)

    /** Stops being friends; the other account is not told. */
    fun endFriendship(accountId: String)

    /** The accounts this one snoozed. */
    fun snoozes(): List<Snooze>

    /** Takes an account's posts out of the home feed for 30 days; until when, in Unix milliseconds. */
    fun snoozePerson(accountId: String): ULong

    /** Ends a snooze. */
    fun unsnoozePerson(accountId: String)
}

/** [SocialFriends] over the core's client. */
class CoreFriends(
    private val lazyClient: Lazy<CoreClient>,
) : SocialFriends {
    private val client by lazyClient

    override fun person(accountId: String) = client.person(accountId)

    override fun friends(
        sort: FriendSort,
        query: String?,
    ) = client.friends(sort, query)

    override fun friendRequests() = client.friendRequests()

    override fun sendFriendRequest(accountId: String) = client.sendFriendRequest(accountId)

    override fun cancelFriendRequest(accountId: String) = client.cancelFriendRequest(accountId)

    override fun acceptFriendRequest(accountId: String) = client.acceptFriendRequest(accountId)

    override fun declineFriendRequest(accountId: String) = client.declineFriendRequest(accountId)

    override fun endFriendship(accountId: String) = client.endFriendship(accountId)

    override fun snoozes() = client.snoozes()

    override fun snoozePerson(accountId: String) = client.snoozePerson(accountId)

    override fun unsnoozePerson(accountId: String) = client.unsnoozePerson(accountId)
}
