package samtak.spjall.social

import androidx.navigation.NavController

/** The routes of the community screens (decision 0063); the two tabs are [COMMUNITIES] and [NOTIFICATIONS]. */
object SocialRoutes {
    const val FEED = "feed"
    const val COMMUNITIES = "communities"
    const val NOTIFICATIONS = "notifications"
    const val NEW_COMMUNITY = "community-new"
    const val COMMUNITY = "community"
    const val POST = "post"
    const val REPORTS = "reports"
    const val REQUESTS = "requests"
    const val ANONYMOUS = "anonymous"
    const val STATEMENTS = "statements"
    const val FRIENDS = "friends"
    const val PERSON = "person"

    fun community(id: String) = "$COMMUNITY/$id"

    /** The pattern the post screen is registered under: [focus] opens it with the comment field focused. */
    const val POST_PATTERN = "$POST/{id}?focus={focus}"

    fun post(
        id: String,
        focus: Boolean = false,
    ) = if (focus) "$POST/$id?focus=true" else "$POST/$id"

    fun person(accountId: String) = "$PERSON/$accountId"

    fun reports(id: String) = "$REPORTS/$id"

    fun requests(id: String) = "$REQUESTS/$id"

    fun anonymous(id: String) = "$ANONYMOUS/$id"

    /**
     * The patterns of the screens that lay out their own columns on an expanded window (0087), as the web's wide
     * pages.
     */
    val WIDE =
        setOf(FEED, COMMUNITIES, NEW_COMMUNITY, "$COMMUNITY/{id}", "$REPORTS/{id}", "$REQUESTS/{id}", "$ANONYMOUS/{id}")
}

/**
 * The bell's tap (decisions 0109, 0111): the notifications open over the screen it was pressed on, so back returns
 * there (#349). The notifications already on the stack are returned to rather than stacked a second time.
 */
internal fun NavController.openNotifications() {
    if (!popBackStack(SocialRoutes.NOTIFICATIONS, inclusive = false)) {
        navigate(SocialRoutes.NOTIFICATIONS) { launchSingleTop = true }
    }
}
