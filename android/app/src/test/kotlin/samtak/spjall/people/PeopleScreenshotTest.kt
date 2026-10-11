package samtak.spjall.people

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.Person
import samtak.spjall.ui.SpjallTheme

/** The people picker in its two modes (decision 0043), compared with the images in src/test/screenshots/. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class PeopleScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val actions =
        object : PeopleActions {
            override fun open(account: String) = Unit

            override fun group() = Unit

            override fun single() = Unit

            override fun toggle(account: String) = Unit

            override fun start() = Unit

            override fun search(text: String) = Unit

            override fun more() = Unit

            override fun invite() = Unit

            override fun retry() = Unit
        }

    private val met = listOf(Person("a2", "Anna Jónsdóttir", true), Person("a3", "Bjarni Pálsson", false))
    private val others = listOf(Person("a4", "Dóra Sigurðardóttir", true))

    private fun shoot(state: PeopleViewModel.State) {
        compose.setContent { SpjallTheme { PeopleScreen(state, actions) } }
        compose.onRoot().captureRoboImage()
    }

    /** A tap opens a 1:1; "Nýr hópur" heads the list. */
    @Test
    fun oneTap() = shoot(PeopleViewModel.State(people = met, directory = others, loaded = true))

    /** Picking several: each row a checkbox, and the start button once someone is picked. */
    @Test
    fun group() =
        shoot(
            PeopleViewModel.State(
                people = met,
                directory = others,
                loaded = true,
                group = true,
                picked = listOf("a2", "a4"),
            ),
        )
}
