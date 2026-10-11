package samtak.spjall.ui

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Every empty screen: an icon, one line, at most one button (decision 0043). */
@RunWith(AndroidJUnit4::class)
class EmptyStateTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun theLineIsReadAndTheIconIsNot() {
        compose.setContent { SpjallTheme { EmptyState(AppIcons.Waves, "Ekkert hér") } }
        compose.onNodeWithText("Ekkert hér").assertExists()
        compose.onAllNodesWithText("Áfram").assertCountEquals(0)
    }

    @Test
    fun itsOneButtonActs() {
        var taps = 0
        compose.setContent {
            SpjallTheme { EmptyState(AppIcons.Waves, "Ekkert hér", action = "Áfram", onAction = { taps++ }) }
        }
        compose.onNodeWithText("Áfram").performClick()
        assertEquals(1, taps)
    }
}
