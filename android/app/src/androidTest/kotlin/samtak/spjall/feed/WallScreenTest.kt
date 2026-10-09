package samtak.spjall.feed

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.brand.R
import samtak.spjall.core.Person
import samtak.spjall.ui.SpjallTheme
import samtak.spjall.ui.capitals

/** Another account's wall opens the encrypted 1:1 with it, without a link (decision 0034). */
@RunWith(AndroidJUnit4::class)
class WallScreenTest {
    @get:Rule val compose = createComposeRule()

    private val calls = mutableListOf<String>()
    private val anna = Person("a2", "Anna Jónsdóttir", false)

    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    private fun show(blocked: Boolean = false) {
        compose.setContent {
            SpjallTheme {
                WallScreen(
                    PostsViewModel.State(loaded = true, me = "a1", person = anna, blocked = blocked),
                    RecordingPostsActions(calls),
                    onBack = { calls += "back" },
                    onContact = { calls += "contact" },
                )
            }
        }
    }

    @Test
    fun theWallSaysWhoAndOpensTheOneToOne() {
        show()
        compose.onNodeWithText("Anna Jónsdóttir".capitals()).assertExists()
        compose.onNodeWithText(text(R.string.wall_empty)).assertExists()
        compose.onNodeWithText(text(R.string.contact_action)).performClick()
        assertEquals(listOf("contact"), calls)
    }

    @Test
    fun aBlockedAccountHasNoButton() {
        show(blocked = true)
        compose.onNodeWithText(text(R.string.contact_action)).assertDoesNotExist()
    }
}
