package samtak.spjall.push

import samtak.spjall.account.Account
import samtak.spjall.core.CoreException

/** Posts and takes away notifications: the system's in the app, a list in tests. */
interface Notifier {
    fun show(announcements: List<Announcement>)

    fun cancel(conversations: List<String>)

    /** Shows or takes away the one notification that says only that something arrived. */
    fun fallback(shown: Boolean)
}

/**
 * Push notifications (decision 0025). A push says only that there is
 * something to fetch: [wake] syncs, then asks the core what to announce and
 * what to take away. In the foreground the screens show what arrives, so
 * [quiet] has the core count it as shown and announces nothing.
 */
class Push(
    private val account: Account,
    private val notifier: Notifier,
    private val labels: () -> Labels,
    private val foreground: () -> Boolean,
) {
    private val lock = Any()

    /** After a push. A failed sync announces that something arrived, without what. */
    fun wake() =
        synchronized(lock) {
            val show = !foreground()
            try {
                account.sync()
            } catch (_: CoreException) {
                if (show) notifier.fallback(true)
                return@synchronized
            }
            settle(show)
        }

    /** While the app is open, and as it closes, so that nothing seen on screen is announced later. */
    fun quiet() = synchronized(lock) { settle(show = false) }

    /** The platform's token, sent with the next sync, which this one starts. */
    fun token(token: String) {
        try {
            account.setPushToken(token, sandbox = false)
            account.sync()
        } catch (_: CoreException) {
            // Kept or not, the next sync tries again.
        }
    }

    /** A conversation was opened: its notification has been seen. */
    fun dismiss(conversation: String) = notifier.cancel(listOf(conversation))

    private fun settle(show: Boolean) {
        val notices =
            try {
                account.notices()
            } catch (_: CoreException) {
                if (show) notifier.fallback(true)
                return
            }
        notifier.fallback(false)
        notifier.cancel(notices.cleared)
        if (show) notifier.show(announcements(notices.shown, labels()))
    }
}
