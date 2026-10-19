package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.ReportTargetKind
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard

/**
 * One community: its name, audience and description, joining or leaving, the box to post in for a member who is
 * not muted, then its posts, newest first.
 */
@Composable
fun CommunityScreen(
    state: CommunityViewModel.State,
    actions: CommunityActions,
) {
    // The post being reported; the dialog closes once the report is sent.
    var reporting by rememberSaveable { mutableStateOf<String?>(null) }
    if (reporting in state.reported) reporting = null
    // This account's own post it asked to delete, until it confirms or cancels.
    var deleting by rememberSaveable { mutableStateOf<String?>(null) }
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))) {
            SubHeader(state.community?.name.orEmpty(), actions::back)
            if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            LazyColumn(
                modifier = Modifier.weight(1f).imePadding(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem) { actions.retry() } } }
                state.community?.let { community -> item(key = "about") { About(community, state, actions) } }
                if (state.writes) {
                    item(key = "composer") { PostComposer(state, actions) }
                }
                if (state.loaded && state.community?.reads == true && state.posts.isEmpty()) {
                    item(key = "empty") { Muted(stringResource(R.string.posts_empty)) }
                }
                itemsIndexed(state.posts, key = { _, item -> item.postId }) { index, post ->
                    PostCard(
                        post = post,
                        reacting = post.postId in state.reacting,
                        reported = post.postId in state.reported,
                        onReact = { actions.react(post.postId, it) },
                        onReport = { reporting = post.postId },
                        onOpen = { actions.open(post.postId) },
                        onDelete = { deleting = post.postId }.takeIf { post.author.accountId == state.me },
                    )
                    if (index == state.posts.lastIndex &&
                        state.next != null
                    ) {
                        LaunchedEffect(state.next) { actions.more() }
                    }
                }
            }
        }
    }
    reporting?.let { postId ->
        ReportDialog(
            onSend = { reason, note -> actions.report(ReportTarget(ReportTargetKind.POST, postId), reason, note) },
            onDismiss = { reporting = null },
        )
    }
    deleting?.let { postId ->
        ConfirmDelete(R.string.post_delete_confirm, onDelete = { actions.delete(postId) }) { deleting = null }
    }
}

/** The box to post in, with the images picked for the post. */
@Composable
private fun PostComposer(
    state: CommunityViewModel.State,
    actions: CommunityActions,
) {
    Composer(
        label = stringResource(R.string.post_compose),
        action = stringResource(R.string.post_publish),
        text = state.draft,
        sending = state.publishing,
        onText = actions::draft,
        onSend = actions::publish,
        ready = state.postable,
    ) { ImagesPicked(state, actions) }
}

/** The images picked for the post, the button that adds one, and why the last one was not taken. */
@Composable
private fun ImagesPicked(
    state: CommunityViewModel.State,
    actions: CommunityActions,
) {
    if (state.images.isNotEmpty()) PickedImages(state.images, actions::removeImage)
    state.imageNotice?.let { notice ->
        Text(
            text =
                stringResource(
                    when (notice) {
                        CommunityViewModel.ImageNotice.TooMany -> R.string.post_images_too_many
                        CommunityViewModel.ImageNotice.TooLarge -> R.string.post_image_too_large
                        CommunityViewModel.ImageNotice.Invalid -> R.string.post_image_failed
                    },
                ),
            style = MaterialTheme.typography.bodyMedium,
            color = Palette.danger,
        )
    }
    OutlinedButton(
        onClick = actions::addImage,
        enabled = !state.publishing,
        modifier = Modifier.heightIn(min = 44.dp),
    ) { Text(stringResource(R.string.post_add_images)) }
}

/** The community's line and description, what this account may do about joining, and the way to its reports. */
@Composable
private fun About(
    community: Community,
    state: CommunityViewModel.State,
    actions: CommunityActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        CommunityLine(community)
        if (community.description.isNotBlank()) {
            Text(text = community.description, style = MaterialTheme.typography.bodyLarge)
        }
        when {
            community.joinRequested ->
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Muted(stringResource(R.string.community_join_requested))
                    OutlinedButton(
                        onClick = actions::withdraw,
                        enabled = !state.busy,
                        modifier = Modifier.heightIn(min = 44.dp),
                    ) { Text(stringResource(R.string.community_withdraw_request)) }
                }
            community.role == null ->
                Button(onClick = actions::join, enabled = !state.busy, modifier = Modifier.heightIn(min = 44.dp)) {
                    Text(
                        stringResource(
                            if (community.audience == CommunityAudience.OPEN) {
                                R.string.community_join
                            } else {
                                R.string.community_request_join
                            },
                        ),
                    )
                }
            community.role != CommunityRole.OWNER ->
                OutlinedButton(
                    onClick = actions::leave,
                    enabled = !state.busy,
                    modifier = Modifier.heightIn(min = 44.dp),
                ) {
                    Text(stringResource(R.string.community_leave))
                }
        }
        if (community.moderates) {
            TextButton(onClick = actions::reports) { Text(stringResource(R.string.moderation_queue)) }
        }
        if (state.muted) Muted(stringResource(R.string.community_muted))
    }
}

@Composable
internal fun Muted(text: String) {
    Text(text = text, style = MaterialTheme.typography.bodyMedium, color = Palette.mutedFg)
}
