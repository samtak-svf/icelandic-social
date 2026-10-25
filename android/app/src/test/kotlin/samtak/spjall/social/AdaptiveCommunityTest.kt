package samtak.spjall.social

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.StateRestorationTester
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
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
import samtak.spjall.frames.FakeFrameRules
import samtak.spjall.frames.LocalFrameRules
import samtak.spjall.ui.SpjallTheme
import java.lang.reflect.Proxy

/**
 * A community by window width (decision 0087): Um samfélagið beside the feed only at the expanded size class, and
 * Stjórna as a section list beside the section chosen only there too.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK])
class AdaptiveCommunityTest {
    @get:Rule val compose = createComposeRule()

    private val choir =
        community("k1", role = CommunityRole.OWNER).copy(description = "Æfingar á þriðjudögum")

    private fun show() {
        val state = CommunityViewModel.State(community = choir, loaded = true)
        compose.setContent {
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) {
                SpjallTheme { CommunityScreen(state, nothing<CommunityActions>()) }
            }
        }
    }

    private fun openManage() {
        compose.onNodeWithText(RuntimeEnvironment.getApplication().getString(R.string.community_manage)).performClick()
    }

    @Test
    @Config(qualifiers = "w412dp-h900dp")
    fun noAsideAtCompact() {
        show()
        compose.onNodeWithTag(COMMUNITY_ASIDE).assertDoesNotExist()
        openManage()
        compose.onNodeWithTag(MANAGE_SECTIONS).assertDoesNotExist()
    }

    @Test
    @Config(qualifiers = "w700dp-h900dp")
    fun noAsideAtMedium() {
        show()
        compose.onNodeWithTag(COMMUNITY_ASIDE).assertDoesNotExist()
        openManage()
        compose.onNodeWithTag(MANAGE_SECTIONS).assertDoesNotExist()
    }

    @Test
    @Config(qualifiers = "w1000dp-h900dp")
    fun anAsideAndTwoPanesAtExpanded() {
        show()
        compose.onNodeWithTag(COMMUNITY_ASIDE).assertIsDisplayed()
        openManage()
        compose.onNodeWithTag(MANAGE_SECTIONS).assertIsDisplayed()
        compose.onNodeWithTag(MANAGE_DETAIL).assertIsDisplayed()
    }

    @Test
    @Config(qualifiers = "w1000dp-h900dp")
    fun theHubShowsTheReadersCommunitiesInAColumnAtExpanded() {
        val state =
            CommunitiesViewModel.State(
                mine = listOf(community("k1", pinned = true, unread = 3uL), community("k2", name = "Hjólreiðar")),
                loaded = true,
            )
        compose.setContent {
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) {
                SpjallTheme { CommunitiesScreen(state, nothing<CommunitiesActions>()) }
            }
        }
        compose.onNodeWithTag(HUB_COLUMN).assertIsDisplayed()
        compose.onNodeWithText(RuntimeEnvironment.getApplication().getString(R.string.communities_tab_mine))
            .assertDoesNotExist()
    }

    @Test
    @Config(qualifiers = "w700dp-h900dp")
    fun theHubKeepsItsTabsBelowExpanded() {
        val state = CommunitiesViewModel.State(mine = listOf(community("k1")), loaded = true)
        compose.setContent {
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) {
                SpjallTheme { CommunitiesScreen(state, nothing<CommunitiesActions>()) }
            }
        }
        compose.onNodeWithTag(HUB_COLUMN).assertDoesNotExist()
        compose.onNodeWithText(RuntimeEnvironment.getApplication().getString(R.string.communities_tab_mine))
            .assertIsDisplayed()
    }

    private fun showCreate() {
        val state = CreateCommunityViewModel.State(name = "Kórinn", description = "Æfingar")
        compose.setContent {
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) {
                SpjallTheme { CreateCommunityScreen(state, nothing<CreateCommunityActions>()) }
            }
        }
    }

    @Test
    @Config(qualifiers = "w1000dp-h900dp")
    fun creatingShowsALivePreviewAtExpanded() {
        showCreate()
        compose.onNodeWithTag(COMMUNITY_PREVIEW).assertIsDisplayed()
    }

    @Test
    @Config(qualifiers = "w412dp-h900dp")
    fun creatingIsTheFormAloneAtCompact() {
        showCreate()
        compose.onNodeWithTag(COMMUNITY_PREVIEW).assertDoesNotExist()
    }

    /** A draft in the composer survives the window growing from a phone to a wide one (the reader's place, 0087). */
    @Test
    @Config(qualifiers = "w412dp-h900dp")
    fun aDraftSurvivesTheWindowGrowingFromCompactToExpanded() {
        val social = FakeSocial().apply { communities["k1"] = community("k1", role = CommunityRole.MEMBER) }
        val restoration = StateRestorationTester(compose)
        restoration.setContent {
            val model: CommunityViewModel =
                viewModel { CommunityViewModel("k1", social, { 0L }, Dispatchers.Unconfined) }
            val state by model.state.collectAsStateWithLifecycle()
            val actions =
                object : CommunityActions by nothing<CommunityActions>() {
                    override fun draft(text: String) = model.draft(text)
                }
            CompositionLocalProvider(LocalFrameRules provides FakeFrameRules) {
                SpjallTheme { CommunityScreen(state, actions) }
            }
        }
        val app = RuntimeEnvironment.getApplication()
        compose.waitUntil(WAIT_MS) {
            compose.onAllNodesWithText(app.getString(R.string.post_compose_prompt)).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText(app.getString(R.string.post_compose_prompt)).performClick()
        compose.onNodeWithText(app.getString(R.string.post_compose)).performTextInput("Halló allir")
        compose.onNodeWithTag(COMMUNITY_ASIDE).assertDoesNotExist()

        RuntimeEnvironment.setQualifiers("w1000dp-h900dp")
        restoration.emulateSavedInstanceStateRestore()

        compose.onNodeWithTag(COMMUNITY_ASIDE).assertIsDisplayed()
        compose.onNodeWithText("Halló allir").assertIsDisplayed()
    }
}

private const val WAIT_MS = 5_000L

/** Actions that do nothing: a test only looks at the layout. */
private inline fun <reified T> nothing(): T =
    Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { proxy, method, args ->
        when (method.name) {
            "equals" -> proxy === args[0]
            "hashCode" -> System.identityHashCode(proxy)
            "toString" -> "nothing"
            else -> null
        }
    } as T
