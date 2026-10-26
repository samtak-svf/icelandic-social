package samtak.spjall.social

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
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
import samtak.spjall.core.AuthorRole
import samtak.spjall.core.Card
import samtak.spjall.core.CardCommunity
import samtak.spjall.core.CardKind
import samtak.spjall.core.CardRef
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.JoinRequest
import samtak.spjall.core.PostImage
import samtak.spjall.core.ReactionCount
import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportTargetKind
import samtak.spjall.core.SocialNotificationKind
import samtak.spjall.frames.FakeFrameRules
import samtak.spjall.frames.LocalFrameRules
import samtak.spjall.ui.IcelandZone
import samtak.spjall.ui.SpjallTheme
import samtak.spjall.ui.wordsCut
import java.lang.reflect.Proxy

/**
 * The social screens (decisions 0060, 0065): the list of communities, a community with a post of two images,
 * a post with its comments, and the report queue. Each in light, dark and at twice the text size, where no
 * word may be cut. See ConversationsScreenshotTest.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class SocialScreenshotTest {
    @get:Rule val compose = createComposeRule()

    @get:Rule val zone = IcelandZone()

    private val choir = community("k1", role = CommunityRole.OWNER).copy(description = "Æfingar á þriðjudögum")
    private val withImages =
        post(
            "p1",
            body = "Myndir frá tónleikunum í gær",
            reactions = listOf(ReactionCount(ReactionKind.LOVE, 3uL)),
            mine = ReactionKind.LOVE,
            comments = 2uL,
        ).copy(images = listOf(PostImage("m1", 800u, 600u), PostImage("m2", 600u, 800u)))

    private val communitiesState =
        CommunitiesViewModel.State(
            mine = listOf(choir, community("k2", name = "Garðyrkjufélagið", role = CommunityRole.MEMBER)),
            found =
                listOf(
                    community("k3", name = "Hlauparar í Laugardal"),
                    community("k4", name = "Foreldrafélagið", audience = CommunityAudience.PRIVATE),
                ),
            verified = true,
            loaded = true,
        )

    // A name too long for one line: the mark must stay on its last word and the badge go to the next line.
    private val longName =
        post(
            "p3",
            body = "Næsta æfing fellur niður",
            author = anna.copy(name = "Anna Margrét Sigurbjörnsdóttir Kristjánsdóttir", role = AuthorRole.OWNER),
        )

    private val communityState =
        CommunityViewModel.State(
            community = choir,
            posts = listOf(withImages, post("p2", body = "Næsta æfing fellur niður", author = self)),
            loaded = true,
            me = OwnAccount(self.accountId, self.name, null),
            writes = true,
        )

    private val longNameState = communityState.copy(posts = listOf(longName))

    private val postState =
        PostViewModel.State(
            post = withImages,
            comments =
                listOf(
                    comment("c1", "p1", body = "Takk fyrir frábært kvöld"),
                    comment("c2", "p1", body = "Sammála", author = self),
                ),
            loaded = true,
            me = OwnAccount(self.accountId, self.name, null),
        )

    private val reportsState =
        ReportsViewModel.State(
            reports = listOf(report("r1", ReportTargetKind.POST, "p1"), report("r2", ReportTargetKind.COMMENT, "c1")),
            cards =
                mapOf(
                    "p1" to
                        Card.Post(
                            CardRef(CardKind.POST, "p1"),
                            CardCommunity("k1", choir.name),
                            anna,
                            "Kaupið ódýr úr á þessari síðu",
                            null,
                            1_700_000_000_000uL,
                        ),
                    "c1" to
                        Card.Comment(
                            CardRef(CardKind.COMMENT, "c1"),
                            CardCommunity("k1", choir.name),
                            "p1",
                            anna,
                            "Þetta er dónalegt",
                            1_700_000_000_000uL,
                        ),
                ),
            loaded = true,
        )

    private val requestsState =
        JoinRequestsViewModel.State(
            requests =
                listOf(
                    JoinRequest("a2", "Anna", true, 1_700_000_000_000uL),
                    JoinRequest("a3", null, false, 1_700_100_000_000uL),
                ),
            loaded = true,
        )

    private val declinedState =
        communityState.copy(
            community = community("k5", audience = CommunityAudience.PRIVATE),
            posts = emptyList(),
            writes = false,
            declinedUntil = 1_800_000_000_000uL,
        )

    private val notificationsState =
        NotificationsViewModel.State(
            notifications =
                listOf(
                    notification("n1", SocialNotificationKind.COMMENT, 1_700_000_000_000uL),
                    notification("n2", SocialNotificationKind.JOIN_APPROVED, 1_700_000_000_000uL).copy(read = true),
                ),
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

    private val communitiesScreen = @Composable { CommunitiesScreen(communitiesState, none<CommunitiesActions>()) }
    private val communityScreen = @Composable { CommunityScreen(communityState, none<CommunityActions>()) }
    private val longNameScreen = @Composable { CommunityScreen(longNameState, none<CommunityActions>()) }
    private val postScreen = @Composable { PostScreen(postState, none<PostActions>()) }
    private val requestsScreen = @Composable { JoinRequestsScreen(requestsState, none<JoinRequestsActions>()) }
    private val declinedScreen = @Composable { CommunityScreen(declinedState, none<CommunityActions>()) }
    private val reportsScreen = @Composable { ReportsScreen(reportsState, none<ReportsActions>()) }
    private val notificationsScreen =
        @Composable { NotificationsScreen(notificationsState, none<NotificationsActions>()) }

    @Test
    fun communities() = shoot(communitiesScreen)

    @Test
    @Config(qualifiers = "+night")
    fun communitiesAtNight() = shoot(communitiesScreen)

    @Test
    @Config(fontScale = 2f)
    fun communitiesLargeText() = shoot(communitiesScreen)

    @Test
    @Config(fontScale = 2f)
    fun communitiesCutsNoWord() = noWordCut(communitiesScreen)

    @Test
    fun community() = shoot(communityScreen)

    @Test
    @Config(qualifiers = "+night")
    fun communityAtNight() = shoot(communityScreen)

    @Test
    @Config(fontScale = 2f)
    fun communityLargeText() = shoot(communityScreen)

    @Test
    @Config(fontScale = 2f)
    fun communityCutsNoWord() = noWordCut(communityScreen)

    @Test
    fun longNameKeepsTheMarkOnItsLastWord() = shoot(longNameScreen)

    @Test
    fun post() = shoot(postScreen)

    @Test
    @Config(qualifiers = "+night")
    fun postAtNight() = shoot(postScreen)

    @Test
    @Config(fontScale = 2f)
    fun postLargeText() = shoot(postScreen)

    @Test
    @Config(fontScale = 2f)
    fun postCutsNoWord() = noWordCut(postScreen)

    @Test
    fun joinRequests() = shoot(requestsScreen)

    @Test
    @Config(qualifiers = "+night")
    fun joinRequestsAtNight() = shoot(requestsScreen)

    @Test
    @Config(fontScale = 2f)
    fun joinRequestsCutsNoWord() = noWordCut(requestsScreen)

    @Test
    fun declined() = shoot(declinedScreen)

    @Test
    @Config(fontScale = 2f)
    fun declinedCutsNoWord() = noWordCut(declinedScreen)

    @Test
    fun reports() = shoot(reportsScreen)

    @Test
    @Config(qualifiers = "+night")
    fun reportsAtNight() = shoot(reportsScreen)

    @Test
    @Config(fontScale = 2f)
    fun reportsLargeText() = shoot(reportsScreen)

    @Test
    @Config(fontScale = 2f)
    fun reportsCutsNoWord() = noWordCut(reportsScreen)

    @Test
    fun notifications() = shoot(notificationsScreen)

    @Test
    @Config(qualifiers = "+night")
    fun notificationsAtNight() = shoot(notificationsScreen)

    @Test
    @Config(fontScale = 2f)
    fun notificationsLargeText() = shoot(notificationsScreen)

    @Test
    @Config(fontScale = 2f)
    fun notificationsCutsNoWord() = noWordCut(notificationsScreen)

    @Test
    fun subScreensPadForBottomNavigationBar() {
        assertEquals(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom, SUB_SCREEN_SIDES)
        assertEquals(120, WindowInsets(bottom = 120).only(SUB_SCREEN_SIDES).getBottom(Density(1f)))
    }
}

/** Actions that do nothing: a screenshot only draws. */
private inline fun <reified T> none(): T =
    Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, _, _ -> null } as T
