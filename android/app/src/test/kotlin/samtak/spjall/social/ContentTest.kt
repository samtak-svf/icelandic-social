package samtak.spjall.social

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import samtak.spjall.brand.R
import samtak.spjall.core.Card
import samtak.spjall.core.CardCommunity
import samtak.spjall.core.CardKind
import samtak.spjall.core.CardRef
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.EmojiCount

class ContentTest {
    @Test
    fun aNewReactionMovesTheCountsFromTheOldOne() {
        val post =
            post(
                "p1",
                emojis = listOf(EmojiCount("\uD83D\uDC4D", 1uL), EmojiCount("\uD83D\uDE22", 2uL)),
                mine = "\uD83D\uDC4D",
            )
        val changed = post.reacted("\uD83D\uDE22")
        assertEquals("\uD83D\uDE22", changed.myEmoji)
        assertEquals(listOf(EmojiCount("\uD83D\uDE22", 3uL)), changed.emojis)
        val taken = changed.reacted(null)
        assertNull(taken.myEmoji)
        assertEquals(listOf(EmojiCount("\uD83D\uDE22", 2uL)), taken.emojis)
    }

    @Test
    fun anyEmojiIsGroupedAndOrderedByCount() {
        val family = "\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67"
        val flag = "\uD83C\uDDEE\uD83C\uDDF8"
        val post = post("p1", emojis = listOf(EmojiCount(flag, 1uL), EmojiCount("\uD83D\uDC4D", 1uL)))
        val changed = post.reacted(family)
        assertEquals(family, changed.myEmoji)
        assertEquals(listOf(flag, "\uD83D\uDC4D", family), changed.emojis.map { it.emoji })
        assertEquals(flag + "\uD83D\uDC4D", changed.summaryEmojis(2))
        val moved = changed.reacted(flag)
        assertEquals(EmojiCount(flag, 2uL), moved.emojis.first())
        assertEquals(listOf(flag, "\uD83D\uDC4D"), moved.emojis.map { it.emoji })
    }

    @Test
    fun anAnonymousPostIsBylinedFromMineNeverFromTheAuthor() {
        assertNull(post("p1").anonymousBylineRes())
        assertNull(post("p1", author = self).anonymousBylineRes())
        assertEquals(
            R.string.post_anonymous_author,
            post("p1", author = null, anonymous = true, own = false).anonymousBylineRes(),
        )
        assertEquals(
            R.string.post_anonymous_mine,
            post("p1", author = null, anonymous = true, own = true).anonymousBylineRes(),
        )
    }

    @Test
    fun aCardWithNoAuthorIsBylinedAnonymous() {
        val reference = CardRef(CardKind.POST, "p1")
        val community = CardCommunity("k1", "K")
        assertNull(Card.Post(reference, community, self, "Texti", null, 0uL).anonymousBylineRes())
        assertEquals(
            R.string.post_anonymous_author,
            Card.Post(reference, community, null, "Texti", null, 0uL).anonymousBylineRes(),
        )
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

    @Test
    fun aMemberReadsWhyThereIsNoComposerAndAReadOnlyCommunityOutlastsAMute() {
        val member = community("k1", role = CommunityRole.MEMBER)
        assertNull(member.noPostNotice(0))
        assertEquals(R.string.community_read_only, member.copy(readOnly = true).noPostNotice(0))
        val muted = member.copy(mutedUntil = 100uL)
        assertEquals(R.string.community_muted, muted.noPostNotice(99))
        assertNull(muted.noPostNotice(100))
        assertEquals(R.string.community_read_only, muted.copy(readOnly = true).noPostNotice(99))
        assertNull(community("k1").copy(readOnly = true).noPostNotice(0))
    }
}
