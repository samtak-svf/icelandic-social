package samtak.spjall.me

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
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
import samtak.spjall.ui.capitals

/** Ég shows the person and their link; everything else is behind the gear (decision 0034). */
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

            override fun readMarkers(on: Boolean) {
                calls += "readMarkers $on"
            }

            override fun typing(on: Boolean) {
                calls += "typing $on"
            }

            override fun unblock(account: String) {
                calls += "unblock $account"
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

            override fun notificationSettings() {
                calls += "notificationSettings"
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
                    AccountDevice("d2", Platform.IOS, 1_710_000_000_000u, current = false),
                ),
            )
        compose.setContent {
            SpjallTheme {
                MeScreen(
                    MeViewModel.State(
                        me = me,
                        link = link,
                    ),
                    actions,
                    onSettings = { calls += "settings" },
                )
            }
        }
    }

    @Test
    fun theGearOpensTheSettings() {
        show()
        compose.onNodeWithContentDescription(text(R.string.settings_title)).performClick()
        assertEquals(listOf("settings"), calls)
    }

    @Test
    fun theSettingsAreNotOnEg() {
        show()
        compose.onNodeWithText(text(R.string.delete_account)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.devices_title).capitals()).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.devices_title)).assertDoesNotExist()
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
        // The link travels as the QR code and the share sheet; its text stays out of sight.
        compose.onNodeWithText("https://link.test/l/abc").assertDoesNotExist()
        compose.onNodeWithContentDescription(text(R.string.invite_link_title)).assertExists()
        compose.onNodeWithText(text(R.string.share)).performScrollTo().performClick()
        assertEquals(listOf("share https://link.test/l/abc"), calls)
    }
}
