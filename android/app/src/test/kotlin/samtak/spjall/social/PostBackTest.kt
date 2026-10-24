package samtak.spjall.social

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import samtak.spjall.conversations.SCREENSHOT_SDK

/** Back on a post goes to its community without stacking a second copy of it (#157). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [SCREENSHOT_SDK])
class PostBackTest {
    @get:Rule val compose = createComposeRule()

    private lateinit var nav: NavController

    private fun host(start: String) {
        compose.setContent {
            val controller = rememberNavController()
            nav = controller
            NavHost(controller, startDestination = start) {
                page("communities")
                page("${SocialRoutes.COMMUNITY}/{id}")
                page(SocialRoutes.POST_PATTERN)
            }
        }
        compose.waitForIdle()
    }

    private fun NavGraphBuilder.page(route: String) = composable(route) { Page(route) }

    @Composable
    private fun Page(route: String) = Text(route)

    private fun go(route: String) {
        compose.runOnUiThread { nav.navigate(route) }
        compose.waitForIdle()
    }

    private fun leave(communityId: String) {
        compose.runOnUiThread { nav.leavePostForCommunity(communityId) }
        compose.waitForIdle()
    }

    /** The screens on the back stack, bottom first, as the routes were opened. */
    private fun stack(): List<String> =
        nav.currentBackStack.value.mapNotNull { entry ->
            val route = entry.destination.route ?: return@mapNotNull null
            val id = entry.arguments?.getString("id")
            if (id == null) route else route.substringBefore('/').substringBefore('?') + "/" + id
        }

    @Test
    fun backToTheCommunityThePostWasOpenedFromPopsInsteadOfStacking() {
        host("communities")
        go(SocialRoutes.community("c1"))
        go(SocialRoutes.post("p1"))
        leave("c1")
        assertEquals(listOf("communities", "community/c1"), stack())
    }

    @Test
    fun aPostOpenedFromALinkLandsOnItsCommunityAndTheCommunitysBackSkipsThePost() {
        host("communities")
        go(SocialRoutes.post("p1"))
        leave("c1")
        assertEquals(listOf("communities", "community/c1"), stack())
        compose.runOnUiThread { nav.popBackStack() }
        compose.waitForIdle()
        assertEquals(listOf("communities"), stack())
    }

    @Test
    fun aPostOpenedFromAnotherCommunityReplacesThePostWithItsOwnCommunityOnce() {
        host("communities")
        go(SocialRoutes.community("c2"))
        go(SocialRoutes.post("p1"))
        leave("c1")
        assertEquals(listOf("communities", "community/c2", "community/c1"), stack())
    }

    @Test
    fun leavingTwiceNeverStacksTheSameCommunityTwice() {
        host("communities")
        go(SocialRoutes.post("p1"))
        leave("c1")
        // A second leave with the community already on top finds no post to pop and must not add a copy.
        leave("c1")
        assertEquals(listOf("communities", "community/c1"), stack())
    }
}
