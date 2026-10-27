package samtak.spjall.push

import kotlinx.coroutines.runBlocking
import samtak.spjall.account.Account
import samtak.spjall.core.CoreException
import samtak.spjall.core.SocialNotice
import samtak.spjall.socket.Live

/** Posts and takes away notifications: the system's in the app, a list in tests. */
interface Notifier {
    fun show(announcements: List<Announcement>)

    fun cancel(conversations: List<String>)

    /** Posts the social notifications, one per notification id, so a group that grew replaces its own. */
    fun showSocial(announcements: List<SocialAnnouncement>)

    fun cancelSocial(notificationIds: List<String>)

    /** Shows or takes away the one notification that says only that something arrived. */
    fun fallback(shown: Boolean)
}

/**
 * Push notifications (decision 0025). A push says only that there is
 * something to fetch: [wake] syncs, then asks the core what to announce and
 * what to take away. In the foreground the screens show what arrives, so
 * [quiet] has the core count it as shown and announces nothing.
 *
 * Each sync runs through [live], in turn with the socket's calls, and its events reach the screens like
 * the socket's own: a sync stores what it fetches only once, so one whose events went nowhere left an open
 * conversation without a message it would never hear of again (#324).
 */
class Push(
    private val account: Account,
    private val live: Live,
    private val notifier: Notifier,
    private val labels: () -> Labels,
    /** The words of a social notice: the list row's sentence, from the same rule (decision 0107). */
    private val sentence: (SocialNotice) -> String,
    private val foreground: () -> Boolean,
) {
    private val lock = Any()

    /** After a push. A failed sync announces that something arrived, without what. */
    fun wake() =
        synchronized(lock) {
            val show = !foreground()
            try {
                sync()
            } catch (_: CoreException) {
                if (show) notifier.fallback(true)
                return@synchronized
            }
            settle(show)
        }

    /** While the app is open, and as it closes, so that nothing seen on screen is announced later. */
    fun quiet() = synchronized(lock) { settle(show = false) }

    /**
     * The platform's token, sent with the next sync. A token the server lacks
     * starts that sync now; the one it already has, given again at each
     * launch, starts none (0056).
     */
    fun token(token: String) {
        try {
            if (account.setPushToken(token, sandbox = false)) sync()
        } catch (_: CoreException) {
            // Kept or not, the next sync tries again.
        }
    }

    /** A conversation was opened: its notification has been seen. */
    fun dismiss(conversation: String) = notifier.cancel(listOf(conversation))

    /** A notification in the list was opened, read or removed: its system notification has been seen. */
    fun dismissNotice(notificationId: String) = notifier.cancelSocial(listOf(notificationId))

    /** Syncs on the caller's thread, a push's or the token's own, and waits for it; throws what it threw. */
    private fun sync() = runBlocking { live.performAndWait { it.sync() } }

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
        notifier.cancelSocial(notices.socialCleared)
        if (show) {
            notifier.show(announcements(notices.shown, labels()))
            notifier.showSocial(socialAnnouncements(notices.social, sentence))
        }
    }
}
