package samtak.spjall.social

/**
 * A first page asked for again, with the older pages already [shown] kept below it. When the page's last row is not
 * among them (a whole page is new, or that row is gone) there is nothing to join to, and the page stands alone.
 */
internal fun <T> keepingOlder(
    page: List<T>,
    pageNext: String?,
    shown: List<T>,
    shownNext: String?,
    id: (T) -> String,
): Pair<List<T>, String?> {
    val last = page.lastOrNull()?.let(id)
    val at = shown.indexOfFirst { id(it) == last }
    return if (pageNext == null || at < 0 || at == shown.lastIndex) {
        page to pageNext
    } else {
        (page + shown.drop(at + 1)) to shownNext
    }
}
