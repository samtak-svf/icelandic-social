package samtak.spjall.social

/** The routes of the community screens (decision 0063); the two tabs are [COMMUNITIES] and [NOTIFICATIONS]. */
object SocialRoutes {
    const val COMMUNITIES = "communities"
    const val NOTIFICATIONS = "notifications"
    const val NEW_COMMUNITY = "community-new"
    const val COMMUNITY = "community"
    const val POST = "post"
    const val REPORTS = "reports"

    fun community(id: String) = "$COMMUNITY/$id"

    fun post(id: String) = "$POST/$id"

    fun reports(id: String) = "$REPORTS/$id"
}
