package samtak.spjall.social

import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import samtak.spjall.brand.R
import samtak.spjall.ui.LocalSuspension
import samtak.spjall.ui.LocalSuspensionRefresh
import samtak.spjall.ui.dateTime

/** Provides the suspension in force to [content]; the screens read it to disable writing and show the notice. */
@Composable
fun WithSuspension(
    social: Social,
    content: @Composable () -> Unit,
) {
    val model: SuspensionViewModel = viewModel(key = "suspension") { SuspensionViewModel(social) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { model.load() }
    val suspension by model.state.collectAsStateWithLifecycle()
    CompositionLocalProvider(
        LocalSuspension provides suspension,
        LocalSuspensionRefresh provides model::load,
        content = content,
    )
}

/**
 * What every hosted social screen is given: the notification levels, where post images come from, the suspension in
 * force, and the way to the statements.
 */
@Composable
internal fun WithSocialHost(
    social: Social,
    openStatements: () -> Unit,
    content: @Composable () -> Unit,
) {
    WithNotificationLevels(social) {
        WithPostImages(social) {
            WithSuspension(social) {
                CompositionLocalProvider(LocalOpenStatements provides openStatements, content = content)
            }
        }
    }
}

/** True while this account may not write: the controls that post, comment, react, vote, join or invite read it. */
@Composable
internal fun suspended(): Boolean = LocalSuspension.current != null

/** How much of a control remains while a suspension has turned it off: it reads as off, not as a dead tap. */
private const val SUSPENDED_ALPHA = 0.4f

/** Dims a control that writes while the account is suspended; the control itself is disabled where it is built. */
@Composable
internal fun Modifier.dimmedWhenSuspended(): Modifier = if (suspended()) alpha(SUSPENDED_ALPHA) else this

/**
 * The notice under a social screen's header while the account is suspended, with the way to the statement that says
 * why (0115). Nothing when it is not, and not on a conversation, which a suspension does not touch.
 */
@Composable
internal fun SuspendedNotice() {
    val suspension = LocalSuspension.current ?: return
    val until = suspension.until
    SocialCard(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).testTag("suspended-notice")) {
        Text(
            text =
                if (until == null) {
                    stringResource(R.string.suspended_notice)
                } else {
                    stringResource(R.string.suspended_notice_until, dateTime(until))
                },
            style = MaterialTheme.typography.bodyMedium,
        )
        TextButton(onClick = LocalOpenStatements.current, modifier = Modifier.heightIn(min = 44.dp)) {
            Text(stringResource(R.string.statement_open))
        }
    }
}
