package samtak.spjall.ui

import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BackTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun aSecondTapDuringTheExitDoesNotPopTheListToo() {
        compose.setContent {
            val nav = rememberNavController()
            NavHost(nav, startDestination = "list") {
                composable("list") { Text("list") }
                composable("conversation") {
                    val back = rememberBack(nav)
                    TextButton(onClick = back) { Text("back") }
                }
            }
            LaunchedEffect(Unit) { nav.navigate("conversation") }
        }
        compose.onNodeWithText("back").assertIsDisplayed()
        // Hold the clock so the conversation is still on screen, leaving, when the second tap lands.
        compose.mainClock.autoAdvance = false
        compose.onNodeWithText("back").performClick()
        compose.onNodeWithText("back").performClick()
        compose.mainClock.autoAdvance = true
        compose.onNodeWithText("list").assertIsDisplayed()
    }
}
