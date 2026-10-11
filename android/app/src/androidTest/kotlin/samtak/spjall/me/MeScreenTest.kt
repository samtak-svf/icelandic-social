package samtak.spjall.me

import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.height
import androidx.compose.ui.unit.width
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.brand.R
import samtak.spjall.core.AccountDevice
import samtak.spjall.core.Me
import samtak.spjall.core.Platform
import samtak.spjall.ui.SpjallTheme
import samtak.spjall.ui.capitals

/** Ég shows the person, their photo and their link, and no wall (decision 0044). */
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
        link: String? = null,
        name: String = "Jón Jónsson",
        verified: Boolean = true,
        photo: String? = null,
    ) {
        val me =
            Me(
                "a1",
                name,
                verified,
                listOf(
                    AccountDevice("d1", Platform.ANDROID, 1_700_000_000_000u, current = true),
                    AccountDevice("d2", Platform.IOS, 1_710_000_000_000u, current = false),
                ),
                photo,
            )
        compose.setContent {
            SpjallTheme {
                MeScreen(
                    MeViewModel.State(
                        me = me,
                        link = link,
                    ),
                    actions,
                )
            }
        }
    }

    @Test
    fun withNoPhotoOneCanBeSetAndTheScreenSaysWhoSeesIt() {
        show()
        compose.onNodeWithText(text(R.string.photo_seen_by_all)).assertExists()
        compose.onNodeWithText(text(R.string.photo_remove)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.photo_choose)).performClick()
        assertEquals(listOf("choosePhoto"), calls)
    }

    @Test
    fun aTapOnTheEmptyCircleOpensThePickerToo() {
        show()
        compose.onNodeWithContentDescription(text(R.string.photo_choose)).performClick()
        assertEquals(listOf("choosePhoto"), calls)
    }

    @Test
    fun aTapOnThePhotoOpensThePickerToReplaceIt() {
        show(photo = "v1")
        compose.onNodeWithContentDescription(text(R.string.photo_change)).performClick()
        assertEquals(listOf("choosePhoto"), calls)
    }

    @Test
    fun aPhotoCanBeReplacedOrRemovedAndRemovingAsksFirst() {
        show(photo = "v1")
        compose.onNodeWithText(text(R.string.photo_change)).performClick()
        assertEquals(listOf("choosePhoto"), calls)
        compose.onNodeWithText(text(R.string.photo_remove)).performClick()
        compose.onNodeWithText(text(R.string.photo_remove_confirm)).assertExists()
        assertEquals("nothing is removed on one tap", listOf("choosePhoto"), calls)
        compose.onAllNodesWithText(text(R.string.photo_remove)).onLast().performClick()
        assertEquals(listOf("choosePhoto", "removePhoto"), calls)
    }

    @Test
    fun anAccountKenniHasNotVerifiedIsOfferedTheShield() {
        show(verified = false)
        compose.onNodeWithText(text(R.string.verify_cta)).performClick()
        assertEquals(listOf("verify"), calls)
    }

    @Test
    fun theShieldFollowsANameThatWraps() {
        val name = "Jónína Guðrún Sigurbjörg Aðalsteinsdóttir"
        show(name = name)
        val heading = compose.onNodeWithText(name.capitals(), substring = true).getBoundsInRoot()
        val mark = compose.onNodeWithContentDescription(text(R.string.verified_with_kennitala)).getBoundsInRoot()
        assertTrue("the name wraps", heading.height > mark.height * 2)
        assertTrue(
            "the shield sits inside the name's lines",
            mark.right <= heading.right && mark.bottom <= heading.bottom,
        )
        assertTrue("the shield is full size", mark.width >= 20.dp)
    }

    @Test
    fun aVerifiedAccountIsNotOfferedItAgain() {
        show()
        compose.onNodeWithText(text(R.string.verify_cta)).assertDoesNotExist()
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
