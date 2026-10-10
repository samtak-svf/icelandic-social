package samtak.spjall.me

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
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
import samtak.spjall.core.Person
import samtak.spjall.core.Platform
import samtak.spjall.core.Settings
import samtak.spjall.ui.SpjallTheme
import samtak.spjall.ui.calendarDate
import samtak.spjall.ui.capitals

/** Nothing that cannot be undone happens on one tap. */
@RunWith(AndroidJUnit4::class)
class SettingsScreenTest {
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

            override fun choosePhoto() {
                calls += "choosePhoto"
            }

            override fun removePhoto() {
                calls += "removePhoto"
            }

            override fun retry() {
                calls += "retry"
            }

            override fun notificationSettings() {
                calls += "notificationSettings"
            }

            override fun verify() {
                calls += "verify"
            }
        }

    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    private fun show(
        blocked: List<Person> = emptyList(),
        notificationsOff: Boolean = false,
    ) {
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
                SettingsScreen(
                    MeViewModel.State(
                        me = me,
                        settings = Settings(readMarkers = true, typing = false),
                        blocked = blocked,
                    ),
                    actions,
                    onBack = { calls += "back" },
                    notificationsOff = notificationsOff,
                )
            }
        }
    }

    @Test
    fun theArrowGoesBack() {
        show()
        compose.onNodeWithContentDescription(text(R.string.back)).performClick()
        assertEquals(listOf("back"), calls)
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
    fun devicesShowWhenTheyWereAddedAndWhichIsThisOne() {
        show()
        val added = InstrumentationRegistry.getInstrumentation().targetContext
        compose.onNodeWithText(text(R.string.device_this).capitals()).assertIsDisplayed()
        compose.onNodeWithText(added.getString(R.string.device_added, calendarDate(1_710_000_000_000u))).assertExists()
    }

    @Test
    fun notificationsThatAreOnNeedNoRow() {
        show()
        compose.onNodeWithText(text(R.string.notifications_off)).assertDoesNotExist()
    }

    @Test
    fun blockedNotificationsSayWhereToTurnThemOn() {
        show(notificationsOff = true)
        compose.onNodeWithText(text(R.string.notifications_off)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(text(R.string.notifications_settings)).performClick()
        assertEquals(listOf("notificationSettings"), calls)
    }

    @Test
    fun theTogglesShowTheSettingsAndChangeThem() {
        show()
        compose
            .onNodeWithText(text(R.string.read_receipts_setting))
            .performScrollTo()
            .assertIsOn()
            .performClick()
        compose
            .onNodeWithText(text(R.string.typing_setting))
            .performScrollTo()
            .assertIsOff()
            .performClick()
        assertEquals(listOf("readMarkers false", "typing true"), calls)
    }

    @Test
    fun unblockingAsksFirst() {
        show(blocked = listOf(Person("a3", "Björn", false)))
        compose.onNodeWithText("Björn").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(text(R.string.unblock)).performScrollTo().performClick()
        val confirm = InstrumentationRegistry.getInstrumentation().targetContext
        compose.onNodeWithText(confirm.getString(R.string.unblock_confirm, "Björn")).assertIsDisplayed()
        compose.onAllNodesWithText(text(R.string.unblock))[1].performClick()
        assertEquals(listOf("unblock a3"), calls)
    }

    @Test
    fun noOneBlockedSaysSo() {
        show()
        compose.onNodeWithText(text(R.string.blocked_empty)).performScrollTo().assertIsDisplayed()
    }
}
