package samtak.spjall.social

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard

/**
 * The community's feed: the box to write a post in for a member who may, then the posts newest first, each
 * reportable, openable and (this account's own) deletable through the callbacks.
 */
@Composable
internal fun Feed(
    modifier: Modifier,
    state: CommunityViewModel.State,
    actions: CommunityActions,
    listState: LazyListState,
    composing: Boolean,
    callbacks: FeedCallbacks,
) {
    LazyColumn(
        modifier = modifier,
        state = listState,
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem) { actions.retry() } } }
        state.community?.let { community ->
            item(key = "about") {
                About(community, state, actions, callbacks.onManage, callbacks.onInfo)
            }
        }
        if (state.writes) {
            item(key = "composer") { ComposerPillOrBox(state, actions, composing, callbacks.onCompose) }
        }
        if (state.loaded && state.community?.reads == true && state.posts.isEmpty()) {
            val emptyText =
                if (state.searchQuery.isNotBlank()) R.string.community_search_empty else R.string.posts_empty
            item(key = "empty") { Muted(stringResource(emptyText)) }
        }
        itemsIndexed(state.posts, key = { _, item -> item.postId }) { index, post ->
            PostCard(
                post = post,
                reacting = post.postId in state.reacting,
                reported = post.postId in state.reported,
                callbacks =
                    PostCardCallbacks(
                        onReact = { actions.react(post.postId, it) },
                        onReport = { callbacks.onReport(post.postId) },
                        onOpen = { actions.open(post.postId) },
                        onComment = { actions.comment(post.postId) },
                        onDelete = { callbacks.onDelete(post.postId) }.takeIf { post.mine },
                        onPin =
                            { pinned: Boolean -> actions.pin(post.postId, pinned) }.takeIf {
                                state.community?.moderates ==
                                    true
                            },
                        onSendToConversation = { actions.sendToConversation(post.postId) },
                    ),
            )
            if (index == state.posts.lastIndex &&
                state.next != null
            ) {
                LaunchedEffect(state.next) { actions.more() }
            }
        }
    }
}

/**
 * The box to post in: one row to tap when nothing is written yet, the whole composer once it is, with the
 * images picked for the post.
 */
@Composable
private fun ComposerPillOrBox(
    state: CommunityViewModel.State,
    actions: CommunityActions,
    composing: Boolean,
    onCompose: () -> Unit,
) {
    val empty = state.draft.isEmpty() && state.images.isEmpty() && state.imageNotice == null
    if (composing || !empty) {
        PostComposer(state, actions)
    } else {
        SocialCard(modifier = Modifier.clickable(role = Role.Button) { onCompose() }) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Avatar(name = state.me?.name, kind = AvatarKind.Me, size = 36.dp, photo = state.me?.photo)
                Text(
                    text = stringResource(R.string.post_compose_prompt),
                    color = Palette.mutedFg,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.weight(1f),
                )
                IconButton(
                    onClick = {
                        onCompose()
                        actions.addImage()
                    },
                ) {
                    Icon(AppIcons.Camera, contentDescription = stringResource(R.string.post_add_images))
                }
            }
        }
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
            text = notice.text(),
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
