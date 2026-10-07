package samtak.spjall.me

/** What [MeScreen] can ask for. */
interface MeActions {
    fun newLink()

    fun share(link: String)

    fun readMarkers(on: Boolean)

    fun typing(on: Boolean)

    fun unblock(account: String)

    fun revoke(deviceId: String)

    fun deleteAccount()

    fun retry()
}
