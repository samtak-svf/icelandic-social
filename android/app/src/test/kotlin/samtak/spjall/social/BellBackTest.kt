package samtak.spjall.social

import androidx.compose.material3.Text
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
import samtak.spjall.ui.AppRoutes
import samtak.spjall.ui.conversationRoute

/** The bell opens the notifications over the screen it was pressed on, and back returns there (#349). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [SCREENSHOT_SDK])
class BellBackTest {
    @get:Rule val compose = createComposeRule()

    private lateinit var nav: NavController

    private fun host() {
        compose.setContent {
            val controller = rememberNavController()
            nav = controller
            NavHost(controller, startDestination = AppRoutes.LIST) {
                page(AppRoutes.LIST)
                page("${AppRoutes.CONVERSATION}/{id}")
                page(SocialRoutes.NOTIFICATIONS)
                page(SocialRoutes.POST_PATTERN)
            }
        }
        compose.waitForIdle()
    }

    private fun NavGraphBuilder.page(route: String) = composable(route) { Text(route) }

    private fun onUi(step: NavController.() -> Unit) {
        compose.runOnUiThread { nav.step() }
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
    fun backFromTheBellReturnsToTheConversationItWasPressedOn() {
        host()
        onUi { navigate(conversationRoute("c1")) }
        onUi { openNotifications() }
        assertEquals(listOf("conversations", "conversation/c1", "notifications"), stack())
        onUi { popBackStack() }
        assertEquals(listOf("conversations", "conversation/c1"), stack())
    }

    @Test
    fun theBellOnTheNotificationsStacksNoSecondCopy() {
        host()
        onUi { openNotifications() }
        onUi { openNotifications() }
        assertEquals(listOf("conversations", "notifications"), stack())
    }

    @Test
    fun theBellOnAPostOpenedFromTheNotificationsReturnsToThemRatherThanStackingThemAgain() {
        host()
        onUi { navigate(conversationRoute("c1")) }
        onUi { openNotifications() }
        onUi { navigate(SocialRoutes.post("p1")) }
        onUi { openNotifications() }
        assertEquals(listOf("conversations", "conversation/c1", "notifications"), stack())
    }
}
