package samtak.spjall.conversation

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import samtak.spjall.conversation.ConversationViewModel.Media
import samtak.spjall.core.Content
import samtak.spjall.socket.item

/** Which messages reach their bubble's edges, and which have no frame at all (0053). */
class AttachmentTest {
    private val photo = item(1u, content = Content.Media("image/jpeg", 10uL, null, null))
    private val captioned = item(2u, content = Content.Media("image/jpeg", 10uL, "Esjan", null))
    private val file = item(3u, content = Content.Media("application/pdf", 10uL, null, "skýrsla.pdf"))

    @Test
    fun aPhotoFillsItsBubbleWhileItLoadsAndOnceReady() {
        assertTrue(photo.edgeToEdge(null))
        assertTrue(photo.edgeToEdge(Media.Loading))
        assertTrue(captioned.edgeToEdge(Media.Ready("/p.jpg")))
    }

    @Test
    fun aFileAFailedPhotoAndTextKeepThePaddedBubble() {
        assertFalse(file.edgeToEdge(Media.Ready("/f.pdf")))
        assertFalse(photo.edgeToEdge(Media.Failed))
        assertFalse(item(4u).edgeToEdge(null))
    }

    @Test
    fun onlyAPhotoWithNothingRoundItIsBare() {
        assertTrue(photo.bare(null))
        assertFalse("a caption sits in the bubble's colour", captioned.bare(null))
        assertFalse(
            "the forwarded mark does too",
            item(5u, content = photo.content, forwarded = true).bare(null),
        )
        assertFalse(photo.bare(Media.Failed))
    }
}
