package samtak.spjall.social

/** What [JoinRequestsScreen] can ask for. */
interface JoinRequestsActions {
    fun back()

    fun approve(accountId: String)

    fun decline(accountId: String)

    /** Takes back an invitation that waits (0130). */
    fun withdraw(accountId: String)

    fun retry()
}
