package samtak.spjall.me

/** What [MeScreen] and [SettingsScreen] can ask for: one function per thing they offer, so it is long. */
@Suppress("TooManyFunctions")
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

    /** Opens the screen that scans a browser's link code (decisions 0064, 0077). */
    fun linkBrowser()

    /** Opens what moderators decided about this account's content, and why (decision 0115). */
    fun statements()

    /** The friends, the requests and the snoozes (0114). */
    fun friends()

    /** The system's notification settings for the app. */
    fun notificationSettings()
}
