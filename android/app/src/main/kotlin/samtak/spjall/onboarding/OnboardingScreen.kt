package samtak.spjall.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.me.MeViewModel
import samtak.spjall.onboarding.OnboardingViewModel.Step
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.Palette
import samtak.spjall.ui.PhotoOf
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.Type
import samtak.spjall.ui.capitals

/**
 * The first launch (decision 0043), one step at a time on cream: a photo, set with the picker and upload of
 * "Ég", beside the name sign-in delivered, which cannot be edited here; then why notifications are worth having.
 */
@Composable
fun OnboardingScreen(
    step: Step,
    me: MeViewModel.State,
    actions: OnboardingActions,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.safeDrawingPadding()) {
            when (step) {
                Step.Photo -> PhotoStep(me, actions)
                Step.Notifications -> NotificationsStep(actions)
                Step.Done -> Unit
            }
        }
    }
}

@Composable
private fun ColumnScope.PhotoStep(
    state: MeViewModel.State,
    actions: OnboardingActions,
) {
    val me = state.me
    val hasPhoto = me?.photo != null
    Body {
        Title(R.string.onboarding_photo_title)
        Text(stringResource(R.string.onboarding_photo_body), style = MaterialTheme.typography.bodyLarge)
        Avatar(
            me?.name,
            kind = AvatarKind.Me,
            size = AVATAR.dp,
            photo = me?.photo?.let { PhotoOf(me.accountId, it) },
            modifier = Modifier.padding(top = 8.dp),
        )
        me?.name?.let { Text(it.capitals(), style = Type.accountName, color = Palette.fg) }
    }
    Buttons {
        if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        state.problem?.let { ProblemCard(it, actions::retry) }
        if (hasPhoto) {
            Primary(R.string.onboarding_continue, actions::photoDone)
            Secondary(R.string.photo_change, actions::choosePhoto, enabled = !state.busy)
        } else {
            Primary(R.string.photo_choose, actions::choosePhoto, enabled = !state.busy)
            Secondary(R.string.onboarding_skip, actions::photoDone)
        }
    }
}

@Composable
private fun ColumnScope.NotificationsStep(actions: OnboardingActions) {
    Body {
        Icon(AppIcons.Bell, contentDescription = null, tint = Palette.primary, modifier = Modifier.size(BELL.dp))
        Title(R.string.notifications_priming_title)
        Text(stringResource(R.string.notifications_priming_body), style = MaterialTheme.typography.bodyLarge)
    }
    Buttons {
        Primary(R.string.notifications_enable, actions::enable)
        Secondary(R.string.not_now, actions::notNow)
    }
}

/** The step's words, scrolling when a large font needs more than the screen. */
@Composable
private fun ColumnScope.Body(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier =
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        content = content,
    )
}

@Composable
private fun Buttons(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier.padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

@Composable
private fun Title(text: Int) {
    Text(
        text = stringResource(text),
        style = Type.accountName,
        modifier = Modifier.semantics { heading() },
    )
}

@Composable
private fun Primary(
    text: Int,
    onClick: () -> Unit,
    enabled: Boolean = true,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(PILL_RADIUS.dp),
        modifier = Modifier.fillMaxWidth().heightIn(min = PILL.dp),
    ) {
        Text(stringResource(text), style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun Secondary(
    text: Int,
    onClick: () -> Unit,
    enabled: Boolean = true,
) {
    TextButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = TARGET.dp),
    ) {
        Text(stringResource(text), color = Palette.fg)
    }
}

private const val AVATAR = 96
private const val BELL = 56
private const val PILL = 52
private const val PILL_RADIUS = 26
private const val TARGET = 48
