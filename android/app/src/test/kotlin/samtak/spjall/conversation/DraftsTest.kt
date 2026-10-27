package samtak.spjall.conversation

import org.junit.Assert.assertEquals
import org.junit.Test

/** #337: what the next account signs in to is a composer with nothing in it. */
class DraftsTest {
    @Test
    fun clearForgetsEveryDraft() {
        val drafts = Drafts()
        drafts["c1"] = "unsent one"
        drafts["c2"] = "unsent two"
        drafts.clear()
        assertEquals("", drafts["c1"])
        assertEquals("", drafts["c2"])
    }

    @Test
    fun aDraftWrittenAfterClearIsKept() {
        val drafts = Drafts()
        drafts["c1"] = "old"
        drafts.clear()
        drafts["c1"] = "new"
        assertEquals("new", drafts["c1"])
    }
}
