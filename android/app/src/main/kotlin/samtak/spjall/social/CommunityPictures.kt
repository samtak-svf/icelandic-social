package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Community

/** The picture and the cover, set or removed at once, apart from the text of the dialog (0080). */
@Composable
internal fun PictureRows(
    community: Community,
    busy: Boolean,
    actions: CommunityActions,
) {
    ImageRow(
        R.string.community_picture_choose,
        R.string.community_picture_remove,
        community.photo != null,
        busy,
        actions::pickPicture,
        actions::removePicture,
    )
    ImageRow(
        R.string.community_cover_choose,
        R.string.community_cover_remove,
        community.cover != null,
        busy,
        actions::pickCover,
        actions::removeCover,
    )
}

/**
 * A community picture or cover: a button to pick one, and one to take it away while there is one (0080). A button
 * that does not fit beside the other wraps whole to the next line, never letter by letter.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ImageRow(
    choose: Int,
    remove: Int,
    present: Boolean,
    busy: Boolean,
    onChoose: () -> Unit,
    onRemove: () -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = onChoose, enabled = !busy) { Text(stringResource(choose)) }
        if (present) TextButton(onClick = onRemove, enabled = !busy) { Text(stringResource(remove)) }
    }
}
