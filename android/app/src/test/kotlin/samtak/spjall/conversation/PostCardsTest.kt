package samtak.spjall.conversation

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import samtak.spjall.account.unreachable
import samtak.spjall.conversations.Outgoing
import samtak.spjall.core.Card
import samtak.spjall.social.FakeSocial
import samtak.spjall.social.community
import samtak.spjall.social.post

class PostCardsTest {
    private val social = FakeSocial()

    init {
        social.communities["k1"] = community("k1")
        social.posts["k1"] = mutableListOf(post("p1", body = "Fundur á morgun"))
    }

    @Test
    fun aSharedPostResolvesToItsCardAndIsAskedForOnce() =
        runTest {
            val cards = PostCards(social) {}
            val first = cards.card("p1")
            val second = cards.card("p1")
            assertTrue(first is Card.Post)
            assertEquals("Fundur á morgun", (first as Card.Post).excerpt)
            assertEquals(first, second)
            assertEquals(1, social.calls.count { it == "cards p1" })
        }

    @Test
    fun aPostThatIsGoneIsUnavailable() =
        runTest {
            assertTrue(PostCards(social) {}.card("p9") is Card.Unavailable)
        }

    @Test
    fun anUnreachableServerGivesNothingAndIsAskedAgainLater() =
        runTest {
            val cards = PostCards(social) {}
            social.failNext = unreachable()
            assertNull(cards.card("p1"))
            assertTrue(cards.card("p1") is Card.Post)
        }

    @Test
    fun aSharedPostIsPreviewedWithoutLookingItUp() {
        assertEquals("p1", (Outgoing.Post("p1")).postId)
    }
}
