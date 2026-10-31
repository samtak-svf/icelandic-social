package samtak.spjall.social

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.Author
import samtak.spjall.core.CardCommunity
import samtak.spjall.core.Friend
import samtak.spjall.core.FriendRequest
import samtak.spjall.core.Relation
import samtak.spjall.core.Snooze
import samtak.spjall.frames.FakeFrameRules
import samtak.spjall.frames.LocalFrameRules
import samtak.spjall.ui.SpjallTheme
import samtak.spjall.ui.wordsCut
import java.lang.reflect.Proxy

/** The friends and person screens (decision 0114): every relation, the lists, night and the largest text. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class FriendsScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val bjorn = Author("a3", "Björn Sigurðsson", false)
    private val dora = Author("a4", "Dóra", true)
    private val eir = Author("a5", null, false)
    private val since = 1_700_000_000_000uL

    private val friendsState =
        FriendsViewModel.State(
            count = 2uL,
            friends = listOf(Friend(anna, since), Friend(bjorn, since + 86_400_000uL)),
            incoming = listOf(FriendRequest(dora, since)),
            sent = listOf(FriendRequest(eir, since)),
            snoozes = listOf(Snooze(bjorn, since + 2_592_000_000uL)),
            loaded = true,
        )

    private val emptyState = FriendsViewModel.State(loaded = true)

    private fun person(
        relation: Relation,
        snoozedUntil: ULong? = null,
    ) = PersonViewModel.State(
        profile =
            profile(
                anna,
                relation,
                friendsSince = if (relation == Relation.FRIENDS) since else null,
                snoozedUntil = snoozedUntil,
                mutualCount = 1uL,
                mutualFriends = listOf(bjorn),
            ).copy(sharedCommunities = listOf(CardCommunity("k1", "Kórinn"))),
        loaded = true,
    )

    private fun shoot(screen: @Composable () -> Unit) {
        compose.setContent {
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) { SpjallTheme { screen() } }
        }
        compose.onRoot().captureRoboImage()
    }

    private fun noWordCut(screen: @Composable () -> Unit) {
        compose.setContent {
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) { SpjallTheme { screen() } }
        }
        assertEquals(emptyList<String>(), compose.wordsCut())
    }

    private val friends = @Composable { FriendsScreen(friendsState, none<FriendsActions>()) }
    private val empty = @Composable { FriendsScreen(emptyState, none<FriendsActions>()) }

    private fun personScreen(state: PersonViewModel.State) = @Composable { PersonScreen(state, none<PersonActions>()) }

    @Test
    fun friends() = shoot(friends)

    @Test
    @Config(qualifiers = "+night")
    fun friendsAtNight() = shoot(friends)

    @Test
    @Config(fontScale = 2f)
    fun friendsCutsNoWord() = noWordCut(friends)

    @Test
    fun friendsWhenThereAreNone() = shoot(empty)

    @Test
    fun personWithNoRelation() = shoot(personScreen(person(Relation.NONE)))

    @Test
    fun personWhoWasAsked() = shoot(personScreen(person(Relation.SENT)))

    @Test
    fun personWhoAsked() = shoot(personScreen(person(Relation.INCOMING)))

    @Test
    fun personWhoIsAFriend() = shoot(personScreen(person(Relation.FRIENDS)))

    @Test
    @Config(qualifiers = "+night")
    fun personWhoIsAFriendAtNight() = shoot(personScreen(person(Relation.FRIENDS)))

    @Test
    fun personSnoozed() = shoot(personScreen(person(Relation.FRIENDS, snoozedUntil = since + 2_592_000_000uL)))

    @Test
    fun personThisAccountItself() = shoot(personScreen(person(Relation.ONESELF)))

    @Test
    @Config(fontScale = 2f)
    fun personCutsNoWord() = noWordCut(personScreen(person(Relation.INCOMING)))
}

private inline fun <reified T> none(): T =
    Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, _, _ -> null } as T
