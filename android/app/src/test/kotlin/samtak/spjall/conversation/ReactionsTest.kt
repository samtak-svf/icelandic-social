package samtak.spjall.conversation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import samtak.spjall.core.Reaction
import samtak.spjall.socket.item
import samtak.spjall.socket.person

class ReactionsTest {
    private val me = person("a1", "Jón")
    private val anna = person("a2", "Anna")
    private val bjarni = person("a3", "Bjarni")

    @Test
    fun aPillShowsUpToThreeEmojiTheMostUsedFirstAndTheCount() {
        val reacted =
            item(
                1u,
                reactions =
                    listOf(
                        Reaction("😮", false, listOf(anna)),
                        Reaction("❤️", true, listOf(me, anna, bjarni)),
                        Reaction("👍", false, listOf(bjarni)),
                        Reaction("😂", false, listOf(anna, bjarni)),
                    ),
            )
        assertEquals(Pill(listOf("❤️", "😂", "😮"), 7, own = true), reacted.pill())
        assertEquals(
            Pill(listOf("👍"), 1, own = false),
            item(2u, reactions = listOf(Reaction("👍", false, listOf(anna)))).pill(),
        )
        assertNull(item(3u).pill())
    }

    @Test
    fun theSheetListsTheReaderFirstAndOnlyTheirLineIsTheirs() {
        val reacted =
            item(
                1u,
                reactions = listOf(Reaction("❤️", true, listOf(anna, me)), Reaction("👍", false, listOf(bjarni))),
            )
        assertEquals(
            listOf(
                ReactionLine(me, "❤️", mine = true),
                ReactionLine(anna, "❤️", mine = false),
                ReactionLine(bjarni, "👍", mine = false),
            ),
            reacted.reactionLines("a1"),
        )
    }

    @Test
    fun theReaderIsTheSenderOfAnOwnMessageElseTheOneOnAnOwnReactionWhoIsNotAMember() {
        val mine = item(2u, sender = me, own = true)
        assertEquals("a1", readerAccount(listOf(item(1u), mine), listOf(anna)))
        val reacted = item(1u, reactions = listOf(Reaction("❤️", true, listOf(anna, me))))
        assertEquals("a1", readerAccount(listOf(reacted), listOf(anna)))
        assertNull(readerAccount(listOf(item(1u)), listOf(anna)))
    }
}
