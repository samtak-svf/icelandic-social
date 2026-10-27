package samtak.spjall.social

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import samtak.spjall.brand.R
import samtak.spjall.core.SocialNotification
import samtak.spjall.core.SocialNotificationKind
import samtak.spjall.ui.AppIcons

/**
 * The "..." of a notification row (decision 0105): read or unread, remove, and, but never for a moderator's
 * notice, which cannot be silenced, this kind in the app only and this community off.
 */
@Composable
fun NoticeMenu(
    notification: SocialNotification,
    actions: NotificationsActions,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) {
            Icon(AppIcons.More, contentDescription = stringResource(R.string.notice_menu))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            val readKey = if (notification.read) R.string.notice_menu_unread else R.string.notice_menu_read
            val readLabel = stringResource(readKey)
            val removeLabel = stringResource(R.string.notice_menu_remove)
            val inAppLabel = stringResource(R.string.notice_menu_kind_in_app)
            val offLabel = stringResource(R.string.notice_menu_community_off)
            val silenceable = notification.kind != SocialNotificationKind.MODERATED
            val items =
                buildList {
                    add(readLabel to { actions.setRead(notification, !notification.read) })
                    add(removeLabel to { actions.remove(notification) })
                    if (silenceable) add(inAppLabel to { actions.kindInApp(notification) })
                    if (silenceable) add(offLabel to { actions.communityOff(notification) })
                }
            items.forEach { (label, act) ->
                DropdownMenuItem(
                    text = { Text(label) },
                    onClick = {
                        open = false
                        act()
                    },
                )
            }
        }
    }
}
