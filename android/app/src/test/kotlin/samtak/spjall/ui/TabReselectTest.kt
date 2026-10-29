package samtak.spjall.ui

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
import samtak.spjall.social.SocialRoutes
import samtak.spjall.social.openNotifications

/**
 * Tapping the active tab returns to its root, and tapping another restores that tab's saved stack (#356) without
 * the notifications left on it (#363).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [SCREENSHOT_SDK])
class TabReselectTest {
    @get:Rule val compose = createComposeRule()

    private lateinit var nav: NavController
    private var current = AppRoutes.LIST

    private fun host() {
        current = AppRoutes.LIST
        compose.setContent {
            val controller = rememberNavController()
            nav = controller
            NavHost(controller, startDestination = AppRoutes.LIST) {
                page(AppRoutes.LIST)
                page("${AppRoutes.CONVERSATION}/{id}")
                page(SocialRoutes.NOTIFICATIONS)
                page(SocialRoutes.COMMUNITIES)
                page(AppRoutes.ME)
            }
        }
        compose.waitForIdle()
    }

    private fun NavGraphBuilder.page(route: String) = composable(route) { Text(route) }

    private fun onUi(step: NavController.() -> Unit) {
        compose.runOnUiThread { nav.step() }
        compose.waitForIdle()
    }

    /** A tap on a tab, tracking the active one as the shell does. */
    private fun tap(root: String) {
        onUi { openTab(root, current) }
        current = root
    }

    /** The screens on the back stack, bottom first, as the routes were opened. */
    private fun stack(): List<String> =
        nav.currentBackStack.value.mapNotNull { entry ->
            val route = entry.destination.route ?: return@mapNotNull null
            val id = entry.arguments?.getString("id")
            if (id == null) route else route.substringBefore('/').substringBefore('?') + "/" + id
        }

    @Test
    fun reselectingTheTabAfterTheBellPathReturnsToItsRoot() {
        host()
        onUi { navigate(conversationRoute("c1")) }
        onUi { openNotifications() }
        tap(SocialRoutes.COMMUNITIES)
        tap(AppRoutes.LIST)
        assertEquals(listOf("conversations", "conversation/c1"), stack())
        tap(AppRoutes.LIST)
        assertEquals(listOf("conversations"), stack())
    }

    @Test
    fun aTabLeftFromTheNotificationsComesBackWithoutThem() {
        host()
        tap(AppRoutes.ME)
        onUi { openNotifications() }
        tap(AppRoutes.LIST)
        assertEquals(listOf("conversations"), stack())
        tap(AppRoutes.ME)
        assertEquals(listOf("conversations", "me"), stack())
    }

    @Test
    fun reselectingFromANestedScreenReturnsToTheRoot() {
        host()
        onUi { navigate(conversationRoute("c1")) }
        tap(AppRoutes.LIST)
        assertEquals(listOf("conversations"), stack())
    }

    @Test
    fun anotherTabRestoresTheSavedStack() {
        host()
        onUi { navigate(conversationRoute("c1")) }
        tap(SocialRoutes.COMMUNITIES)
        tap(AppRoutes.LIST)
        assertEquals(listOf("conversations", "conversation/c1"), stack())
    }
}
