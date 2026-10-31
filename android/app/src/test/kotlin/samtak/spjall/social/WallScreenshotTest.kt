package samtak.spjall.social

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.Author
import samtak.spjall.core.Relation
import samtak.spjall.core.WallAudience
import samtak.spjall.frames.FakeFrameRules
import samtak.spjall.frames.LocalFrameRules
import samtak.spjall.ui.SpjallTheme
import samtak.spjall.ui.wordsCut
import java.lang.reflect.Proxy

/** The wall (decision 0115): the own wall's three tabs, another person's, the removal dialog, night. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class WallScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val since = 1_700_000_000_000uL

    private fun wallState(
        who: Author,
        relation: Relation,
        tab: WallTab = WallTab.POSTS,
    ) = PersonViewModel.State(
        profile = profile(who, relation, friendsSince = since),
        wall = wallOf(who.accountId, "Ég hlusta á kórinn.", null),
        posts =
            listOf(
                wallPost("w1", who, "Fyrsta færsla", WallAudience.FRIENDS),
                wallPost("w2", who, "Önnur færsla", WallAudience.EVERYONE),
            ),
        tab = tab,
        loaded = true,
    )

    private fun wallPost(
        id: String,
        who: Author,
        text: String,
        audience: WallAudience,
    ) = post(id, author = who, body = text).copy(wallOwner = who.accountId, audience = audience)

    private fun shoot(screen: @Composable () -> Unit) {
        compose.setContent {
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) { SpjallTheme { screen() } }
        }
        compose.onRoot().captureRoboImage()
    }

    private fun wall(state: PersonViewModel.State) =
        @Composable { PersonScreen(state, wallNone<PersonActions>(), tab = true) }

    @Test
    fun ownWallPosts() = shoot(wall(wallState(self, Relation.ONESELF)))

    @Test
    @Config(qualifiers = "+night")
    fun ownWallPostsAtNight() = shoot(wall(wallState(self, Relation.ONESELF)))

    @Test
    fun ownWallAbout() = shoot(wall(wallState(self, Relation.ONESELF, WallTab.ABOUT)))

    @Test
    fun ownWallImages() = shoot(wall(wallState(self, Relation.ONESELF, WallTab.IMAGES)))

    @Test
    fun anotherPersonsWall() = shoot(wall(wallState(anna, Relation.FRIENDS)))

    // A dialog with a text field never lets Robolectric's clock idle (as with the group name dialog), so the
    // rule that enables its button is checked on its own.
    @Test
    fun aReasonIsNeededAndHasALimit() {
        assertFalse(removeReasonOk(" "))
        assertTrue(removeReasonOk("Meiðyrði"))
        assertTrue(removeReasonOk("x".repeat(REMOVE_REASON_MAX)))
        assertFalse(removeReasonOk("x".repeat(REMOVE_REASON_MAX + 1)))
    }

    @Test
    @Config(fontScale = 2f)
    fun ownWallCutsNoWord() {
        compose.setContent {
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) {
                SpjallTheme { wall(wallState(self, Relation.ONESELF))() }
            }
        }
        assertEquals(emptyList<String>(), compose.wordsCut())
    }
}

private inline fun <reified T> wallNone(): T =
    Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, _, _ -> null } as T
