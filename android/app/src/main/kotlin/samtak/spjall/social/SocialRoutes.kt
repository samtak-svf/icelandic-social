package samtak.spjall.social

/** The routes of the community screens (decision 0063); the two tabs are [COMMUNITIES] and [NOTIFICATIONS]. */
object SocialRoutes {
    const val COMMUNITIES = "communities"
    const val NOTIFICATIONS = "notifications"
    const val NEW_COMMUNITY = "community-new"
    const val COMMUNITY = "community"
    const val POST = "post"
    const val REPORTS = "reports"
    const val REQUESTS = "requests"

    fun community(id: String) = "$COMMUNITY/$id"

    /** The pattern the post screen is registered under: [focus] opens it with the comment field focused. */
    const val POST_PATTERN = "$POST/{id}?focus={focus}"

    fun post(
        id: String,
        focus: Boolean = false,
    ) = if (focus) "$POST/$id?focus=true" else "$POST/$id"

    fun reports(id: String) = "$REPORTS/$id"

    fun requests(id: String) = "$REQUESTS/$id"
}
