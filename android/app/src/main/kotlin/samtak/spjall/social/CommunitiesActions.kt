package samtak.spjall.social

/** What [CommunitiesScreen] can ask for. */
interface CommunitiesActions {
    fun open(communityId: String)

    /** "Stofna samfélag": only offered to a verified account (decision 0063). */
    fun create()

    fun search(text: String)

    /** The end of the search came into view. */
    fun more()

    fun retry()
}
