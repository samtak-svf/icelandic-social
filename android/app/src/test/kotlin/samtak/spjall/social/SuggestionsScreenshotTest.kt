package samtak.spjall.social

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
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
import samtak.spjall.core.Friend
import samtak.spjall.frames.FakeFrameRules
import samtak.spjall.frames.LocalFrameRules
import samtak.spjall.me.SuggestionSettingSection
import samtak.spjall.ui.Palette
import samtak.spjall.ui.SpjallTheme
import samtak.spjall.ui.wordsCut
import java.lang.reflect.Proxy

/** The suggestions section of the friends screen and the switch in the settings (decision 0114). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class SuggestionsScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val long = Author("s1", "Guðmundur Sigurbjörnsson Hjaltalín Þórarinsson-Kjartansson", true)
    private val short = Author("s2", "Dóra", false)
    private val since = 1_700_000_000_000uL

    private val state =
        FriendsViewModel.State(
            count = 1uL,
            friends = listOf(Friend(anna, since)),
            suggestions = listOf(long, short),
            loaded = true,
        )

    private fun shoot(screen: @Composable () -> Unit) {
        compose.setContent {
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) { SpjallTheme { screen() } }
        }
        compose.onRoot().captureRoboImage()
    }

    private val section = @Composable { FriendsScreen(state, none<FriendsActions>()) }

    private fun switch(
        included: Boolean,
        busy: Boolean = false,
    ): @Composable () -> Unit {
        val setting = SuggestionSetting(SuggestionSettingViewModel.State(included, busy), {}, {})
        return {
            CompositionLocalProvider(LocalSuggestionSetting provides setting) {
                Column(modifier = Modifier.background(Palette.bg).padding(16.dp)) { SuggestionSettingSection() }
            }
        }
    }

    @Test
    fun friendsWithSuggestions() = shoot(section)

    @Test
    @Config(qualifiers = "+night")
    fun friendsWithSuggestionsAtNight() = shoot(section)

    @Test
    @Config(fontScale = 2f)
    fun suggestionsCutNoWord() {
        compose.setContent {
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) { SpjallTheme { section() } }
        }
        assertEquals(emptyList<String>(), compose.wordsCut())
    }

    @Test
    fun suggestionSwitchOn() = shoot(switch(true))

    @Test
    fun suggestionSwitchIsHeldWhileAWriteRuns() {
        compose.setContent { SpjallTheme { switch(included = true, busy = true)() } }
        compose.onNode(isToggleable()).assertIsDisplayed().assertIsNotEnabled()
    }

    @Test
    fun suggestionSwitchIsLiveWhenNothingRuns() {
        compose.setContent { SpjallTheme { switch(included = true)() } }
        compose.onNode(isToggleable()).assertIsDisplayed().assertIsEnabled()
    }

    @Test
    fun suggestionSwitchOff() = shoot(switch(false))
}

private inline fun <reified T> none(): T =
    Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, _, _ -> null } as T
