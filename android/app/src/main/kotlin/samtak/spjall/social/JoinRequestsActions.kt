package samtak.spjall.social

/** What [JoinRequestsScreen] can ask for. */
interface JoinRequestsActions {
    fun back()

    fun approve(accountId: String)

    fun decline(accountId: String)

    fun retry()
}
