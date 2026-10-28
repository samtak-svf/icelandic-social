package samtak.spjall.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffoldLayout
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteType
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The places and the screen under them (decision 0087): the [tabs] as a bar along the bottom of a compact window
 * and as a rail down the left of a wider one, drawn by the navigation suite, and the [bell] every full screen's
 * header draws at its end (decisions 0109, 0111). With [shown] false (a screen opened from a tab) neither bar nor
 * rail is drawn. Each screen pads for the status bar itself, so the bar and the rail pad only for the edge they sit
 * on, and the content is told that edge is spoken for.
 *
 * The content is one centred column no wider than [CONTENT_WIDTH], as on the web; a [wide] screen (the community,
 * the hub, Stjórna, creating a community) lays out its own columns on an expanded window and gets the whole width.
 * The tree is the same at every width, so nothing on screen loses its state when the window changes class.
 */
@Composable
fun AdaptiveNavigation(
    tabs: List<Tab>,
    bell: Bell?,
    shown: Boolean,
    wide: Boolean,
    content: @Composable () -> Unit,
) {
    val layout = currentLayout()
    val navigation = layout.navigation
    val width = if (wide && layout.community == CommunityLayout.FEED_AND_ASIDE) Dp.Infinity else CONTENT_WIDTH.dp
    val type =
        when {
            !shown -> NavigationSuiteType.None
            navigation == Navigation.BAR -> NavigationSuiteType.NavigationBar
            else -> NavigationSuiteType.NavigationRail
        }
    NavigationSuiteScaffoldLayout(
        navigationSuite = {
            when {
                !shown -> Unit
                navigation == Navigation.BAR -> TabBar(tabs)
                else -> TabRail(tabs)
            }
        },
        layoutType = type,
    ) {
        val taken =
            when (type) {
                NavigationSuiteType.NavigationBar -> WindowInsets.navigationBars
                NavigationSuiteType.NavigationRail -> WindowInsets.systemBars.only(WindowInsetsSides.Start)
                else -> WindowInsets(0)
            }
        Box(Modifier.fillMaxSize().consumeWindowInsets(taken), contentAlignment = Alignment.TopCenter) {
            Box(Modifier.widthIn(max = width)) {
                CompositionLocalProvider(LocalBell provides bell) { content() }
            }
        }
    }
}
