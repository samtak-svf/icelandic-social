package samtak.spjall.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.systemBars
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffoldLayout
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteType
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * The five places and the screen under them (decision 0087): the [tabs] as a bar along the bottom of a compact
 * window and as a rail down the left of a wider one, drawn by the navigation suite. With [shown] false (a screen
 * opened from a tab) neither is drawn. Each screen pads for the status bar itself, so the bar and the rail pad only
 * for the edge they sit on, and the content is told that edge is spoken for.
 */
@Composable
fun AdaptiveNavigation(
    tabs: List<Tab>,
    shown: Boolean,
    content: @Composable () -> Unit,
) {
    val navigation = currentLayout().navigation
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
        Box(Modifier.consumeWindowInsets(taken)) { content() }
    }
}
