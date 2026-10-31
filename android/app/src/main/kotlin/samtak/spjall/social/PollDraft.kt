package samtak.spjall.social

/** The poll half of the post form (decision 0090): the limits mirror the API's `POLL_OPTIONS`. */
object PollDraft {
    const val MIN_OPTIONS = 2
    const val MAX_OPTIONS = 6
    const val OPTION_MAX = 80

    /** Two empty fields, where a poll starts. */
    fun empty(): List<String> = List(MIN_OPTIONS) { "" }

    /** The poll after the toggle: none turns into two empty fields, unless images are picked, and a poll goes away. */
    fun toggled(
        poll: List<String>?,
        hasImages: Boolean,
    ): List<String>? = if (poll != null || hasImages) null else empty()

    /** [poll] with option [index] set to [text]; a text over the limit changes nothing. */
    fun withOption(
        poll: List<String>,
        index: Int,
        text: String,
    ): List<String> =
        if (text.length > OPTION_MAX) poll else poll.mapIndexed { i, old -> if (i == index) text else old }

    /** [poll] with one more empty option, while the poll takes another. */
    fun added(poll: List<String>): List<String> = if (poll.size < MAX_OPTIONS) poll + "" else poll

    /** [poll] without option [index], while it keeps the least a poll has. */
    fun removed(
        poll: List<String>,
        index: Int,
    ): List<String> = if (poll.size > MIN_OPTIONS) poll.filterIndexed { i, _ -> i != index } else poll

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
