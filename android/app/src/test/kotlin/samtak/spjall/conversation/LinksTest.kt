package samtak.spjall.conversation

import org.junit.Assert.assertEquals
import org.junit.Test

class LinksTest {
    /** Each link as written, then what a tap opens. */
    private fun found(text: String) = links(text).map { it.written(text) to it.url }

    @Test
    fun aLinkStartsWithItsSchemeOrWwwAndRunsToASpace() {
        assertEquals(
            listOf(
                "https://samtak.is/a?b=1" to "https://samtak.is/a?b=1",
                "http://dæmi.is" to "http://dæmi.is",
                "www.vedur.is/spa" to "https://www.vedur.is/spa",
            ),
            found("Sjá https://samtak.is/a?b=1 og http://dæmi.is eða www.vedur.is/spa takk"),
        )
    }

    @Test
    fun theSchemeIsFoundInAnyCase() {
        assertEquals(listOf("HTTPS://Samtak.is" to "https://Samtak.is"), found("HTTPS://Samtak.is"))
        assertEquals(listOf("WWW.ruv.is" to "https://www.ruv.is"), found("WWW.ruv.is"))
    }

    @Test
    fun theSentencesPunctuationIsNotPartOfIt() {
        assertEquals(listOf("https://ruv.is" to "https://ruv.is"), found("Lestu https://ruv.is."))
        assertEquals(listOf("https://ruv.is/frett" to "https://ruv.is/frett"), found("https://ruv.is/frett?!"))
        assertEquals(listOf("www.ruv.is" to "https://www.ruv.is"), found("(sjá www.ruv.is)"))
        assertEquals(
            listOf("https://ruv.is" to "https://ruv.is", "https://ruv.is" to "https://ruv.is"),
            found("„https://ruv.is“, sagði hún \"https://ruv.is\""),
        )
        assertEquals(listOf("https://ruv.is" to "https://ruv.is"), found("‚https://ruv.is‘"))
    }

    @Test
    fun aBracketOpenedInsideTheLinkStays() {
        assertEquals(
            listOf(
                "https://is.wikipedia.org/wiki/Hekla_(eldfjall)" to "https://is.wikipedia.org/wiki/Hekla_(eldfjall)",
            ),
            found("Sjá https://is.wikipedia.org/wiki/Hekla_(eldfjall)."),
        )
    }

    @Test
    fun noLinkInPlainTextOrABareSchemeOrAWordEndingInWww() {
        assertEquals(emptyList<Pair<String, String>>(), found("Sæl, ertu við?"))
        assertEquals(emptyList<Pair<String, String>>(), found("https:// og www."))
        assertEquals(emptyList<Pair<String, String>>(), found("abcwww.ruv.is"))
    }
}
