package samtak.spjall.social

import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.ModerationState
import samtak.spjall.core.Post
import samtak.spjall.ui.listStamp

/** Opens this account's statements of reasons; nothing in a screen test that provides none. */
val LocalOpenStatements = staticCompositionLocalOf<() -> Unit> { {} }

/** A removed post as a reader who may not read it gets it (0115): no author, no text, no images. */
fun Post.isTombstone(): Boolean =
    state == ModerationState.REMOVED && author == null && !anonymous && body.isEmpty() && images.isEmpty()

/**
 * What stands in a removed post's place: that a moderator removed it and when. Its author can read why, and a
 * moderator can open the post itself, which the server still gives them.
 */
@Composable
internal fun PostTombstone(
    post: Post,
    moderates: Boolean,
    onOpen: (() -> Unit)?,
) {
    SocialCard {
        Text(stringResource(R.string.content_removed), style = MaterialTheme.typography.bodyMedium)
        Muted(listStamp(post.createdAt))
        if (post.mine) {
            TextButton(onClick = LocalOpenStatements.current, modifier = Modifier.heightIn(min = 44.dp)) {
                Text(stringResource(R.string.statement_open))
            }
        }
        if (moderates && onOpen != null) {
            TextButton(onClick = onOpen, modifier = Modifier.heightIn(min = 44.dp)) {
                Text(stringResource(R.string.post_tombstone_open))
            }
        }
    }
}
