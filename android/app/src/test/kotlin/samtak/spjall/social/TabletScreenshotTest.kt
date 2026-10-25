package samtak.spjall.social

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.brand.R
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.Poll
import samtak.spjall.core.PollOption
import samtak.spjall.frames.FakeFrameRules
import samtak.spjall.frames.LocalFrameRules
import samtak.spjall.ui.IcelandZone
import samtak.spjall.ui.SpjallTheme
import java.lang.reflect.Proxy

/**
 * The expanded layouts of decision 0087 on a tablet in landscape (1280 by 800 dp), and the community at a medium
 * width, as evidence that an Android tablet shows the layouts of its size class: the feed with Um samfélagið and the
 * featured posts beside it, Stjórna as a section list beside the section, and the hub as a column of communities
 * beside the feed. The screens decide their own layout; nothing here picks one.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = TABLET, fontScale = 1f)
class TabletScreenshotTest {
    @get:Rule val compose = createComposeRule()

    @get:Rule val zone = IcelandZone()

    private val tuesday = PollOption("o0", "Þriðjudag", 5uL)
    private val thursday = PollOption("o1", "Fimmtudag", 3uL)
    private val choir = community("k1", role = CommunityRole.OWNER).copy(description = "Æfingar á þriðjudögum")
    private val survey =
        post("p1", body = "Hvaða dag á æfingin að vera?", comments = 4uL)
            .copy(poll = Poll(listOf(tuesday, thursday), 8uL, null, false))
    private val announcement = post("p2", body = "Tónleikar í Hörpu í nóvember", pinned = true)
    private val plain = post("p3", body = "Næsta æfing fellur niður", author = self)

    private val communityState =
        CommunityViewModel.State(
            community = choir.copy(featured = listOf(announcement)),
            posts = listOf(survey, announcement, plain),
            loaded = true,
            me = OwnAccount(self.accountId, self.name, null),
            writes = true,
        )

    private fun shoot(screen: @Composable () -> Unit) {
        show(screen)
        compose.onRoot().captureRoboImage()
    }

    private fun show(screen: @Composable () -> Unit) {
        compose.setContent {
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) { SpjallTheme { screen() } }
        }
    }

    @Test
    fun communityWithAsideAndFeaturedAtExpanded() = shoot { CommunityScreen(communityState, none<CommunityActions>()) }

    @Test
    @Config(qualifiers = "w700dp-h1000dp")
    fun communityAtMedium() = shoot { CommunityScreen(communityState, none<CommunityActions>()) }

    @Test
    fun manageIsListAndDetailAtExpanded() {
        show { CommunityScreen(communityState, none<CommunityActions>()) }
        compose
            .onNodeWithText(RuntimeEnvironment.getApplication().getString(R.string.community_manage))
            .performClick()
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun hubIsCommunitiesBesideTheFeedAtExpanded() {
        val state =
            CommunitiesViewModel.State(
                mine = listOf(community("k1", pinned = true, unread = 3uL), community("k2", name = "Hjólreiðar")),
                feed = listOf(survey, plain),
                loaded = true,
            )
        shoot { CommunitiesScreen(state, none<CommunitiesActions>()) }
    }
}

/** A tablet in landscape: an expanded window by the core's size class. */
private const val TABLET = "w1280dp-h800dp-land"

/** Actions that do nothing; equals, hashCode and toString answer, as a pane scaffold compares what it is given. */
private inline fun <reified T> none(): T =
    Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { proxy, method, args ->
        when (method.name) {
            "equals" -> proxy === args[0]
            "hashCode" -> System.identityHashCode(proxy)
            "toString" -> "none"
            else -> null
        }
    } as T
