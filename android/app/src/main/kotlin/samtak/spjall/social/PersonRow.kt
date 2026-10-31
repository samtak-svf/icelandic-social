package samtak.spjall.social

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import samtak.spjall.core.Author
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.NameWithMark
import samtak.spjall.ui.Palette
import samtak.spjall.ui.photoOf

/**
 * A person in a list (decision 0114): picture, name with the verified mark, an optional [detail] under it, and
 * [trailing] actions on the right. A tap on the picture or the name opens the person, as it does on a post.
 */
@Composable
internal fun PersonRow(
    person: Author,
    detail: String?,
    onOpen: () -> Unit,
    trailing: @Composable () -> Unit = {},
) {
    Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button, onClick = onOpen),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Avatar(
                name = person.name,
                kind = if (person.verified) AvatarKind.Verified else AvatarKind.Unverified,
                size = 40.dp,
                photo = person.photoOf(),
            )
            Column(modifier = Modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                NameWithMark(
                    name = person.shownName(),
                    verified = person.verified,
                    style = MaterialTheme.typography.titleSmall,
                    color = Palette.fg,
                )
                detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Palette.mutedFg) }
            }
        }
        trailing()
    }
}
