package samtak.spjall.ui

import android.provider.Settings
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VisibilityThreshold
import androidx.compose.animation.core.spring
import androidx.compose.foundation.lazy.LazyItemScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntOffset

/**
 * The system asks for no motion (decision 0022): "Remove animations" sets the animator duration
 * scale to 0. Rows then change in place, placeholders hold still and scrolls jump.
 */
fun reducesMotion(animatorScale: Float): Boolean = animatorScale == 0f

/** [spec], or none when [reduce]: what a list's row animation is given. */
fun <T> unlessReduced(
    reduce: Boolean,
    spec: FiniteAnimationSpec<T>,
): FiniteAnimationSpec<T>? = if (reduce) null else spec

/** Whether motion is reduced here; [SpjallTheme] provides it from the system setting. */
val LocalReduceMotion = staticCompositionLocalOf { false }

/** Provides [LocalReduceMotion] from the system's animator duration scale. */
@Composable
internal fun ProvideReduceMotion(content: @Composable () -> Unit) {
    val resolver = LocalContext.current.contentResolver
    val reduce =
        remember(resolver) {
            reducesMotion(Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f))
        }
    CompositionLocalProvider(LocalReduceMotion provides reduce, content = content)
}

/**
 * A row that fades in, moves and fades out as the core's events change its list (decision 0043),
 * and does none of it when [reduce]. [scope] is the row's item scope; the key the list gives the
 * row is what lets it be followed.
 */
fun Modifier.rowMotion(
    scope: LazyItemScope,
    reduce: Boolean,
): Modifier =
    with(scope) {
        this@rowMotion.animateItem(
            fadeInSpec = unlessReduced(reduce, spring(stiffness = Spring.StiffnessMediumLow)),
            placementSpec =
                unlessReduced(
                    reduce,
                    spring(stiffness = Spring.StiffnessMediumLow, visibilityThreshold = IntOffset.VisibilityThreshold),
                ),
            fadeOutSpec = unlessReduced(reduce, spring(stiffness = Spring.StiffnessMediumLow)),
        )
    }

/** To [index], gliding there unless [reduce]: then it jumps. */
suspend fun LazyListState.scrollTo(
    index: Int,
    reduce: Boolean,
) {
    if (reduce) scrollToItem(index) else animateScrollToItem(index)
}
