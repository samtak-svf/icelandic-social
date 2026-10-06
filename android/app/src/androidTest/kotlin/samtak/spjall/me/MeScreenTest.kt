package samtak.spjall.me

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.brand.R
import samtak.spjall.core.AccountDevice
import samtak.spjall.core.Me
import samtak.spjall.core.Platform
import samtak.spjall.ui.SpjallTheme

/** Nothing that cannot be undone happens on one tap. */
@RunWith(AndroidJUnit4::class)
class MeScreenTest {
    @get:Rule val compose = createComposeRule()

    private val calls = mutableListOf<String>()
    private val actions =
        object : MeActions {
            override fun newLink() {
                calls += "newLink"
            }

            override fun share(link: String) {
                calls += "share $link"
            }

            override fun revoke(deviceId: String) {
                calls += "revoke $deviceId"
            }

            override fun deleteAccount() {
                calls += "deleteAccount"
            }

            override fun retry() {
                calls += "retry"
            }
        }

    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    private fun show(link: String? = null) {
        val me =
            Me(
                "a1",
                "Jón Jónsson",
                true,
                listOf(
                    AccountDevice("d1", Platform.ANDROID, 1_700_000_000_000u, current = true),
                    AccountDevice("d2", Platform.IOS, 1_700_000_100_000u, current = false),
                ),
            )
        compose.setContent { SpjallTheme { MeScreen(MeViewModel.State(me = me, link = link), actions) } }
    }

    @Test
    fun deletingTheAccountAsksFirstAndCancelDoesNothing() {
        show()
        compose.onNodeWithText(text(R.string.delete_account)).performScrollTo().performClick()
        compose.onNodeWithText(text(R.string.delete_account_confirm)).assertExists()
        compose.onNodeWithText(text(R.string.cancel)).performClick()
        assertEquals(emptyList<String>(), calls)

        compose.onNodeWithText(text(R.string.delete_account)).performScrollTo().performClick()
        // The dialog's button carries the same words as the one that opened it.
        compose.onAllNodesWithText(text(R.string.delete_account))[1].performClick()
        assertEquals(listOf("deleteAccount"), calls)
    }

    @Test
    fun revokingADeviceAsksFirst() {
        show()
        compose.onAllNodesWithText(text(R.string.device_revoke))[1].performScrollTo().performClick()
        assertEquals(emptyList<String>(), calls)
        compose.onNodeWithText(text(R.string.device_revoke_confirm)).assertExists()
        compose
            .onAllNodesWithText(
                text(R.string.device_revoke),
            ).let { it[it.fetchSemanticsNodes().size - 1] }
            .performClick()
        assertEquals(listOf("revoke d2"), calls)
    }

    @Test
    fun noLinkIsMadeUntilAskedFor() {
        show()
        assertEquals(emptyList<String>(), calls)
        compose.onNodeWithText(text(R.string.invite)).performScrollTo().performClick()
        assertEquals(listOf("newLink"), calls)
    }

    @Test
    fun anExistingLinkIsShownAndShared() {
        show(link = "https://link.test/l/abc")
        compose.onNodeWithText("https://link.test/l/abc").assertExists()
        compose.onNodeWithText(text(R.string.share)).performScrollTo().performClick()
        assertEquals(listOf("share https://link.test/l/abc"), calls)
    }
}
