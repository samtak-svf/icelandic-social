package samtak.spjall.social

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.CommunityImage
import samtak.spjall.core.Relation
import samtak.spjall.frames.FakeFrameRules
import samtak.spjall.frames.LocalFrameRules
import samtak.spjall.ui.SpjallTheme
import java.util.Locale

/** What an own wall shows after the world moved under it: the month in Icelandic, the friends, the images. */
@OptIn(ExperimentalCoroutinesApi::class)
class WallRefreshTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    @Before fun people() {
        social.people[self.accountId] = profile(self, Relation.ONESELF)
    }

    private fun TestScope.ownWall(): PersonViewModel {
        val model = PersonViewModel(self.accountId, social, dispatcher)
        advanceUntilIdle()
        return model
    }

    private fun mediaIds(model: PersonViewModel): List<String> {
        val images = model.state.value.images
        return images.map { it.mediaId }
    }

    private fun image(id: String) = CommunityImage(id, "p-$id", null, 100u, 100u, 1_700_000_000_000uL)

    @Test
    fun theMonthIsIcelandicWhateverTheDeviceLanguage() {
        val saved = Locale.getDefault()
        try {
            Locale.setDefault(Locale.US)
            assertEquals("október 2026", monthName("2026-10"))
        } finally {
            Locale.setDefault(saved)
        }
    }

    @Test
    fun loadingAgainRefreshesImagesOnceTheTabHasBeenOpened() =
        runTest(dispatcher) {
            val model = ownWall()
            model.selectTab(WallTab.IMAGES)
            advanceUntilIdle()
            assertTrue(mediaIds(model).isEmpty())
            social.wallImagesOf[self.accountId] = listOf(image("m1"))
            model.load()
            advanceUntilIdle()
            assertEquals(listOf("m1"), mediaIds(model))
        }

    @Test
    fun aPostPublishedFromTheWallShowsInImagesWhenTheTabIsOpened() =
        runTest(dispatcher) {
            val model = ownWall()
            model.selectTab(WallTab.IMAGES)
            advanceUntilIdle()
            model.selectTab(WallTab.POSTS)
            social.wallImagesOf[self.accountId] = listOf(image("m2"))
            model.onDraft("Mynd")
            model.publish()
            advanceUntilIdle()
            model.selectTab(WallTab.IMAGES)
            advanceUntilIdle()
            assertEquals(listOf("m2"), mediaIds(model))
        }
}

/** The friend count is a way to the friends on the own wall and text on another's (0114). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE)
class FriendCountLinkTest {
    @get:Rule val compose = createComposeRule()

    private class Opened : PersonActions by wallNone() {
        var friends = 0

        override fun friends() {
            friends++
        }
    }

    private fun show(
        relation: Relation,
        actions: PersonActions,
    ) = compose.setContent {
        val who = if (relation == Relation.ONESELF) self else anna
        val state = PersonViewModel.State(profile = profile(who, relation), loaded = true)
        CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) {
            SpjallTheme { PersonScreen(state, actions, tab = relation == Relation.ONESELF) }
        }
    }

    @Test
    fun onTheOwnWallItOpensTheFriendsInATouchTargetOf48dp() {
        val actions = Opened()
        show(Relation.ONESELF, actions)
        val count = compose.onNodeWithTag("friend-count")
        count.assertHasClickAction()
        count.assertHeightIsAtLeast(48.dp)
        count.performClick()
        assertEquals(1, actions.friends)
    }

    @Test
    fun onAnotherPersonsWallItIsOnlyText() {
        show(Relation.FRIENDS, Opened())
        compose.onAllNodesWithTag("friend-count").assertCountEquals(0)
    }
}
