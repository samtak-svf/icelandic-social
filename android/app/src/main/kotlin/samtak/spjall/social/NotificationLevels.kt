package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import samtak.spjall.brand.R
import samtak.spjall.core.NotificationLevel
import samtak.spjall.core.SocialNotificationKind

/** The stored notification levels and the calls that change them, for whichever screen shows a picker. */
class NotificationLevels(
    val state: NotificationSettingsViewModel.State,
    val load: () -> Unit,
    val setKind: (SocialNotificationKind, NotificationLevel) -> Unit,
    val setCommunity: (String, NotificationLevel) -> Unit,
)

/** Where a screen finds the levels; none in a screen test, and then no picker shows. */
val LocalNotificationLevels = compositionLocalOf<NotificationLevels?> { null }

/** Provides the levels to [content], read from the core when a picker first asks for them. */
@Composable
fun WithNotificationLevels(
    social: Social,
    content: @Composable () -> Unit,
) {
    val model: NotificationSettingsViewModel =
        viewModel(key = "notification-levels") { NotificationSettingsViewModel(social) }
    val state by model.state.collectAsStateWithLifecycle()
    val levels = remember(state, model) { NotificationLevels(state, model::load, model::setKind, model::setCommunity) }
    CompositionLocalProvider(LocalNotificationLevels provides levels, content = content)
}

internal fun NotificationLevel.label(): Int =
    when (this) {
        NotificationLevel.PUSH -> R.string.notification_level_push
        NotificationLevel.IN_APP -> R.string.notification_level_in_app
        NotificationLevel.OFF -> R.string.notification_level_off
    }

internal fun SocialNotificationKind.settingLabel(): Int =
    when (this) {
        SocialNotificationKind.COMMENT -> R.string.notification_kind_comment
        SocialNotificationKind.REPLY -> R.string.notification_kind_reply
        SocialNotificationKind.REACTION -> R.string.notification_kind_reaction
        SocialNotificationKind.JOIN_APPROVED -> R.string.notification_kind_join_approved
        SocialNotificationKind.MODERATED -> R.string.notification_kind_moderated
    }

/** A title with the current level, a tap on which opens the [allowed] ones. */
@Composable
fun LevelPicker(
    title: String,
    level: NotificationLevel,
    allowed: List<NotificationLevel>,
    onChange: (NotificationLevel) -> Unit,
    modifier: Modifier = Modifier,
) {
    var open by remember { mutableStateOf(false) }
    Row(
        modifier = modifier.fillMaxWidth().heightIn(min = 48.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Box {
            TextButton(onClick = { open = true }) { Text(stringResource(level.label())) }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                allowed.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(stringResource(option.label())) },
                        onClick = {
                            open = false
                            onChange(option)
                        },
                    )
                }
            }
        }
    }
}

/** The level of one community, on its `community_info`; nothing while the levels are not provided. */
@Composable
internal fun CommunityLevelPicker(communityId: String) {
    val levels = LocalNotificationLevels.current ?: return
    LaunchedEffect(Unit) { levels.load() }
    LevelPicker(
        title = stringResource(R.string.notification_settings_title),
        level = levels.state.community(communityId),
        allowed = communityLevels,
        onChange = { levels.setCommunity(communityId, it) },
        modifier = Modifier.testTag("community-level"),
    )
}
