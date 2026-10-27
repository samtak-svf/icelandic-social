package samtak.spjall.me

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.SocialNotificationKind
import samtak.spjall.social.LevelPicker
import samtak.spjall.social.LocalNotificationLevels
import samtak.spjall.social.allowedLevels
import samtak.spjall.social.communityLevels
import samtak.spjall.social.settingLabel

/**
 * The levels of every notification kind, then of each community with a stored level (decision 0106). A moderator's
 * notice offers only the app and the phone, and says why. Nothing shows while the levels are not provided.
 */
@Composable
internal fun ColumnScope.NotificationLevelsSection() {
    val levels = LocalNotificationLevels.current ?: return
    LaunchedEffect(Unit) { levels.load() }
    Label(R.string.notification_settings_title)
    Panel {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).testTag("notification-levels")) {
            Text(stringResource(R.string.notification_settings_body), style = MaterialTheme.typography.bodyMedium)
            SocialNotificationKind.entries.forEach { kind ->
                LevelPicker(
                    title = stringResource(kind.settingLabel()),
                    level = levels.state.kind(kind),
                    allowed = allowedLevels(kind),
                    onChange = { levels.setKind(kind, it) },
                )
            }
            Text(stringResource(R.string.notification_moderated_floor), style = MaterialTheme.typography.bodyMedium)
            val rows = levels.state.rows()
            if (rows.isNotEmpty()) {
                Text(
                    stringResource(R.string.notification_settings_communities),
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.padding(top = 12.dp),
                )
                rows.forEach { row ->
                    LevelPicker(
                        title = row.name,
                        level = row.level,
                        allowed = communityLevels,
                        onChange = { levels.setCommunity(row.communityId, it) },
                    )
                }
            }
        }
    }
}
