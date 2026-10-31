package samtak.spjall.social

import samtak.spjall.core.Author
import samtak.spjall.core.Friend
import samtak.spjall.core.FriendPage
import samtak.spjall.core.FriendRequest
import samtak.spjall.core.FriendRequests
import samtak.spjall.core.FriendSort
import samtak.spjall.core.PersonProfile
import samtak.spjall.core.Relation
import samtak.spjall.core.Snooze

/** An account as the person screen gets it; [relation] and the counts are what a test varies. */
fun profile(
    author: Author,
    relation: Relation = Relation.NONE,
    friendsSince: ULong? = null,
    snoozedUntil: ULong? = null,
    friendCount: ULong = 3uL,
    mutualCount: ULong = 0uL,
    mutualFriends: List<Author> = emptyList(),
) = PersonProfile(
    accountId = author.accountId,
    name = author.name,
    verified = author.verified,
    photo = null,
    photoFrames = null,
    relation = relation,
    friendsSince = friendsSince,
    friendCount = friendCount,
    mutualCount = mutualCount,
    mutualFriends = mutualFriends,
    sharedCommunities = emptyList(),
    snoozedUntil = snoozedUntil,
)

/**
 * The friend half of [FakeSocial], in memory (0114). The lists answer from [people]'s relations, so an action a test
 * takes changes what the next read returns, as the server would.
 */
@Suppress("TooManyFunctions")
open class FakeSocialFriends :
    FakeSocialNotifications(),
    SocialFriends {
    /** Every account the person screen can open, by id. */
    val people = mutableMapOf<String, PersonProfile>()

    /** Who ends a snooze at what time. */
    val snoozedUntil = mutableMapOf<String, ULong>()

    private fun author(id: String) = people.getValue(id).let { Author(it.accountId, it.name, it.verified) }

    private fun relate(
        id: String,
        relation: Relation,
        since: ULong? = null,
    ) {
        people[id] = people.getValue(id).copy(relation = relation, friendsSince = since)
    }

    private fun with(relation: Relation) = people.values.filter { it.relation == relation }

    override fun person(accountId: String): PersonProfile {
        call("person $accountId")
        val base = people[accountId] ?: throw notFound()
        return base.copy(snoozedUntil = snoozedUntil[accountId])
    }

    override fun friends(
        sort: FriendSort,
        query: String?,
    ): FriendPage {
        call("friends $sort ${query.orEmpty()}".trim())
        val all = with(Relation.FRIENDS).filter { query == null || it.name.orEmpty().contains(query, true) }
        val rows = all.map { Friend(author(it.accountId), it.friendsSince ?: 0uL) }
        val sorted =
            when (sort) {
                FriendSort.NEWEST -> rows.sortedByDescending { it.since }
                FriendSort.NAME -> rows.sortedBy { it.person.name.orEmpty() }
            }
        return FriendPage(sorted.size.toULong(), sorted)
    }

    override fun friendRequests(): FriendRequests {
        call("friendRequests")

        fun of(relation: Relation) = with(relation).map { FriendRequest(author(it.accountId), 1uL) }

        return FriendRequests(of(Relation.INCOMING), of(Relation.SENT))
    }

    override fun sendFriendRequest(accountId: String): Relation {
        call("sendFriendRequest $accountId")
        relate(accountId, Relation.SENT)
        return Relation.SENT
    }

    override fun cancelFriendRequest(accountId: String) {
        call("cancelFriendRequest $accountId")
        relate(accountId, Relation.NONE)
    }

    override fun acceptFriendRequest(accountId: String) {
        call("acceptFriendRequest $accountId")
        relate(accountId, Relation.FRIENDS, 5uL)
    }

    override fun declineFriendRequest(accountId: String) {
        call("declineFriendRequest $accountId")
        relate(accountId, Relation.NONE)
    }

    override fun endFriendship(accountId: String) {
        call("endFriendship $accountId")
        relate(accountId, Relation.NONE)
    }

    override fun snoozes(): List<Snooze> {
        call("snoozes")
        return snoozedUntil.map { (id, until) -> Snooze(author(id), until) }
    }

    override fun snoozePerson(accountId: String): ULong {
        call("snoozePerson $accountId")
        return SNOOZED_UNTIL.also { snoozedUntil[accountId] = it }
    }

    override fun unsnoozePerson(accountId: String) {
        call("unsnoozePerson $accountId")
        snoozedUntil.remove(accountId)
    }

    private companion object {
        const val SNOOZED_UNTIL = 1_800_000_000_000uL
    }
}
