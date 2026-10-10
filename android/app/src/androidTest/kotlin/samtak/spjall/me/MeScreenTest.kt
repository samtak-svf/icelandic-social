package samtak.spjall.me

import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
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
import samtak.spjall.core.Person
import samtak.spjall.core.Platform
import samtak.spjall.core.Post
import samtak.spjall.core.ReactionCounts
import samtak.spjall.feed.PostsViewModel
import samtak.spjall.feed.RecordingPostsActions
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

            override fun verify() {
                calls += "verify"
            }
        }

    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    private fun show(
        link: String? = null,
        name: String = "Jón Jónsson",
        verified: Boolean = true,
        wall: List<Post> = emptyList(),
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
                    wall = PostsViewModel.State(posts = wall, loaded = true, me = "a1"),
                    wallActions = RecordingPostsActions(calls),
                )
            }
        }
    }

    @Test
    fun egIsTheWallWithItsOwnPosts() {
        val mine =
            Post(
                "p1",
                Person("a1", "Jón Jónsson", true),
                "Fyrsta færslan",
                1_700_000_000_000u,
                0u,
                ReactionCounts(0u, 0u, 0u, 0u, 0u),
                null,
            )
        show(wall = listOf(mine))
        compose.onNodeWithText("Fyrsta færslan").performScrollTo().assertExists()
        compose.onNodeWithText(text(R.string.wall_composer_placeholder)).performScrollTo().performClick()
        compose.onNode(hasSetTextAction()).performTextInput("Önnur")
        compose.onNodeWithText(text(R.string.post_action)).performClick()
        assertEquals(listOf("post Önnur"), calls)
    }

    @Test
    fun anEmptyWallSaysSo() {
        show()
        compose.onNodeWithText(text(R.string.wall_empty)).performScrollTo().assertExists()
    }

    @Test
    fun theGearOpensTheSettings() {
        show()
        compose.onNodeWithContentDescription(text(R.string.settings_title)).performClick()
        assertEquals(listOf("settings"), calls)
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
