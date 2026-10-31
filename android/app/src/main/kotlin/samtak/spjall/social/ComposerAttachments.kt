package samtak.spjall.social

import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.ui.Palette

/**
 * What goes with a post's text: its poll or its picked images with the button that adds one, why the last image
 * was not taken, and the button that turns the post into a poll. [off] reads the controls as off (a post on its
 * way, or a suspended account). One copy for the community composer and the wall composer.
 */
@Composable
internal fun ComposerAttachments(
    images: List<String>,
    poll: List<String>?,
    notice: CommunityViewModel.ImageNotice?,
    off: Boolean,
    actions: Attaching,
) {
    if (poll != null) {
        PollFields(poll, actions)
    } else {
        if (images.isNotEmpty()) PickedImages(images, actions::removeImage)
        notice?.let {
            Text(text = it.text(), style = MaterialTheme.typography.bodyMedium, color = Palette.danger)
        }
        OutlinedButton(
            onClick = actions::addImage,
            enabled = !off,
            modifier = Modifier.heightIn(min = 44.dp).testTag("add-image"),
        ) { Text(stringResource(R.string.post_add_images)) }
    }
    if (images.isEmpty()) {
        OutlinedButton(
            onClick = actions::togglePoll,
            enabled = !off,
            modifier = Modifier.heightIn(min = 44.dp).testTag("poll-toggle"),
        ) { Text(stringResource(R.string.composer_poll)) }
    }
}
