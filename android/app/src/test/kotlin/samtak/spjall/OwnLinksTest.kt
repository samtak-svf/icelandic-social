package samtak.spjall

import androidx.compose.ui.platform.UriHandler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import samtak.spjall.core.OwnLink
import samtak.spjall.social.SocialRoutes

/** A link on our own host opens its screen; anything else goes to the platform (decision 0121). */
class OwnLinksTest {
    @Test
    fun aPostAndACommunityHaveTheirScreens() {
        assertEquals(SocialRoutes.post("p1"), ownRoute("a") { OwnLink.Post("p1") })
        assertEquals(SocialRoutes.community("c1"), ownRoute("a") { OwnLink.Community("c1") })
    }

    @Test
    fun anythingElseHasNone() {
        assertNull(ownRoute("a") { null })
    }

    @Test
    fun aLinkToAScreenOpensThereAndNotInTheBrowser() {
        val opened = mutableListOf<String>()
        val other = Recorder()
        OwnLinkHandler({ SocialRoutes.post(it) }, { opened += it }, other).openUri("p1")
        assertEquals(listOf(SocialRoutes.post("p1")), opened)
        assertEquals(emptyList<String>(), other.uris)
    }

    @Test
    fun anyOtherLinkGoesToThePlatform() {
        val opened = mutableListOf<String>()
        val other = Recorder()
        OwnLinkHandler({ null }, { opened += it }, other).openUri("https://example.com")
        assertEquals(emptyList<String>(), opened)
        assertEquals(listOf("https://example.com"), other.uris)
    }

    private class Recorder : UriHandler {
        val uris = mutableListOf<String>()

        override fun openUri(uri: String) {
            uris += uri
        }
    }
}
