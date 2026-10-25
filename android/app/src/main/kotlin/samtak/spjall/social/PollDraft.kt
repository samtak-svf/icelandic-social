package samtak.spjall.social

/** The poll half of the post form (decision 0090): the limits mirror the API's `POLL_OPTIONS`. */
object PollDraft {
    const val MIN_OPTIONS = 2
    const val MAX_OPTIONS = 6
    const val OPTION_MAX = 80

    /** Two empty fields, where a poll starts. */
    fun empty(): List<String> = List(MIN_OPTIONS) { "" }

    /** The options as the API takes them: trimmed. */
    fun options(fields: List<String>): List<String> = fields.map { it.trim() }

    /** Two to six options, none empty, none over 80 characters, none the same as another. */
    fun valid(fields: List<String>): Boolean {
        val options = options(fields)
        return options.size in MIN_OPTIONS..MAX_OPTIONS &&
            options.none { it.isEmpty() || it.length > OPTION_MAX } &&
            options.map { it.lowercase() }.toSet().size == options.size
    }
}

/** The tabs of a community's screen (decision 0089), in the order shown. */
enum class CommunityTab {
    DISCUSSION,
    FEATURED,
    IMAGES,
    MEMBERS,
    ABOUT,
}
