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

    /** Opens the photo picker; the photo it gives becomes this account's (decision 0039). */
    fun choosePhoto()

    /** Opens the crop sheet on the photo already set, to frame it again from its stored master (decision 0086). */
    fun reframePhoto()

    /** Removes the photo, for everyone; the screen has asked first. */
    fun removePhoto()

    fun retry()

    /** Opens the screen that links Kenni, for an account it has not verified (decision 0033). */
    fun verify()

    /** Opens the screen that scans a browser's link code (decisions 0064, 0077). */
    fun linkBrowser()

    /** Opens what moderators decided about this account's content, and why (decision 0115). */
    fun statements()

    /** The system's notification settings for the app. */
    fun notificationSettings()
}
