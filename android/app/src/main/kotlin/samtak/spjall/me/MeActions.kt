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

    /** Opens the screen that links Kenni, for an account it has not verified (decision 0033). */
    fun verify()

    /** The system's notification settings for the app. */
    fun notificationSettings()
}
