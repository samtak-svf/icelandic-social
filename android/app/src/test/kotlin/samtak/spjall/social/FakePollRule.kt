package samtak.spjall.social

/**
 * The core's poll rule for a test that cannot load the native library. [PollRuleVectorsTest] holds it to the shared
 * cases.
 */
object FakePollRule : PollRule {
    private fun trimmed(text: String) = text.trim { it.isWhitespace() || it == '\uFEFF' }

    override fun valid(
        question: String,
        options: List<String>,
    ): Boolean {
        val trimmed = options.map(::trimmed)
        return trimmed(question).isNotEmpty() &&
            trimmed.size in PollDraft.MIN_OPTIONS..PollDraft.MAX_OPTIONS &&
            trimmed.none { it.isEmpty() || it.codePointCount(0, it.length) > PollDraft.OPTION_MAX } &&
            trimmed.map { it.lowercase() }.distinct().size == trimmed.size
    }
}
