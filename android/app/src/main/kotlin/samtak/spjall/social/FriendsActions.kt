package samtak.spjall.social

import samtak.spjall.core.FriendSort

/** What the friends screen asks of its view model, so a screen test can stand in for it (decision 0114). */
interface FriendsActions {
    fun back()

    fun retry()

    fun query(text: String)

    fun sort(sort: FriendSort)

    fun open(accountId: String)

    fun accept(accountId: String)

    fun decline(accountId: String)

    fun cancel(accountId: String)

    fun unsnooze(accountId: String)
}

/** What the person screen asks of its view model. */
interface PersonActions {
    fun back()

    fun retry()

    fun open(accountId: String)

    fun openCommunity(communityId: String)

    fun add()

    fun cancel()

    fun accept()

    fun decline()

    fun end()

    fun snooze()

    fun unsnooze()
}
