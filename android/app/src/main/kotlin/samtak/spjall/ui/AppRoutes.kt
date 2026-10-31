package samtak.spjall.ui

import androidx.navigation.NavController
import androidx.navigation.NavOptionsBuilder
import samtak.spjall.social.SocialRoutes

/** The signed-in graph's destinations, named once for the shell and the screens that lead to each other. */
internal object AppRoutes {
    const val LIST = "conversations"
    const val ME = "me"
    const val SETTINGS = "settings"
    const val VERIFY = "verify"
    const val LINK = "link"
    const val PEOPLE = "people"
    const val CONVERSATION = "conversation"
    const val FORWARD = "forward"
    const val SHARE = "share"
    const val INFO = "info"
}

internal fun conversationRoute(id: String) = "${AppRoutes.CONVERSATION}/$id"

/** A tab keeps one copy of itself on the stack, above the feed (decision 0116), the start of the graph. */
private fun NavOptionsBuilder.tab() {
    popUpTo(SocialRoutes.FEED) { saveState = true }
    launchSingleTop = true
    restoreState = true
}

/**
 * Opens the tab [root] from the tab [current] (null when none is known). [current] is the tab the screen on top
 * belongs to, which the notifications keep when the bell opens them over it. The active tab returns to its root
 * (#356); another tab restores the stack it was left with. The notifications are left behind, not saved with the
 * tab under them, so no tab comes back with them on top (#363).
 */
internal fun NavController.openTab(
    root: String,
    current: String? = null,
) {
    if (root == current && popBackStack(root, inclusive = false)) return
    if (currentDestination?.route == SocialRoutes.NOTIFICATIONS) popBackStack()
    navigate(root) { tab() }
}
