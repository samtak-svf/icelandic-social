package samtak.spjall.social

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.ReactionCount
import samtak.spjall.core.ReactionKind

class ContentTest {
    @Test
    fun aNewReactionMovesTheCountsFromTheOldOne() {
        val post =
            post(
                "p1",
                reactions = listOf(ReactionCount(ReactionKind.LIKE, 1uL), ReactionCount(ReactionKind.SAD, 2uL)),
                mine = ReactionKind.LIKE,
            )
        val changed = post.reacted(ReactionKind.SAD)
        assertEquals(ReactionKind.SAD, changed.myReaction)
        assertEquals(listOf(ReactionCount(ReactionKind.SAD, 3uL)), changed.reactions)
        val taken = changed.reacted(null)
        assertNull(taken.myReaction)
        assertEquals(listOf(ReactionCount(ReactionKind.SAD, 2uL)), taken.reactions)
    }

    @Test
    fun whoReadsWritesAndModerates() {
        val open = community("k1")
        assertTrue(open.reads)
        assertFalse(open.writes(0))
        assertFalse(community("k1", audience = CommunityAudience.PRIVATE).reads)
        assertTrue(community("k1", role = CommunityRole.MEMBER).writes(0))
        assertFalse(community("k1", role = CommunityRole.MEMBER).moderates)
        assertTrue(community("k1", role = CommunityRole.MODERATOR).moderates)
        assertTrue(community("k1", role = CommunityRole.OWNER).moderates)
        val muted = community("k1", role = CommunityRole.MEMBER, mutedUntil = 100uL)
        assertTrue(muted.muted(99))
        assertFalse(muted.writes(99))
        assertFalse(muted.muted(100))
        assertFalse(community("k1", role = CommunityRole.MEMBER).copy(readOnly = true).writes(0))
    }
}
