package samtak.spjall.ui

import androidx.navigation.NavOptionsBuilder

/** The signed-in graph's destinations, named once for the shell and the screens that lead to each other. */
internal object AppRoutes {
    const val LIST = "conversations"
    const val ME = "me"
    const val VERIFY = "verify"
    const val LINK = "link"
    const val PEOPLE = "people"
    const val CONVERSATION = "conversation"
    const val FORWARD = "forward"
    const val SHARE = "share"
    const val INFO = "info"
}

internal fun conversationRoute(id: String) = "${AppRoutes.CONVERSATION}/$id"

/** A tab keeps one copy of itself on the stack, above the list. */
internal fun NavOptionsBuilder.tab() {
    popUpTo(AppRoutes.LIST) { saveState = true }
    launchSingleTop = true
    restoreState = true
}
