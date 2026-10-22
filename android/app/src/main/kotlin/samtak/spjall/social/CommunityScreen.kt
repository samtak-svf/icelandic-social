package samtak.spjall.social

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.ReportTargetKind
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.calendarDate

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
    // The community dialog open, if any.
    var dialog by rememberSaveable { mutableStateOf<CommunityDialog?>(null) }
    var searchVisible by rememberSaveable { mutableStateOf(false) }
    val openInfo = {
        dialog = CommunityDialog.INFO
        if (state.members.isEmpty()) actions.loadMembers()
    }
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(SUB_SCREEN_SIDES))) {
            SubHeader(state.community?.name.orEmpty(), actions::back) {
                IconButton(onClick = { searchVisible = !searchVisible }) {
                    Icon(Icons.Filled.Search, contentDescription = stringResource(R.string.community_search_posts))
                }
                IconButton(onClick = openInfo) {
                    Icon(AppIcons.Info, contentDescription = stringResource(R.string.community_info))
                }
            }
            if (searchVisible) SearchRow(state.searchQuery, actions)
            if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            Feed(
                state = state,
                actions = actions,
                onManage = { dialog = CommunityDialog.MANAGE },
                onReport = { reporting = it },
                onDelete = { deleting = it },
                onInfo = openInfo,
            )
        }
    }
    reporting?.let { postId -> ReportPostDialog(postId, actions) { reporting = null } }
    CommunityDialogs(state, actions, dialog) { dialog = it }
    deleting?.let { postId ->
        ConfirmDelete(R.string.post_delete_confirm, onDelete = { actions.delete(postId) }) { deleting = null }
    }
}

/** The search box for this community's posts, with the button that runs the search. */
@Composable
private fun SearchRow(
    query: String,
    actions: CommunityActions,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = actions::onSearchQuery,
            placeholder = { Text(stringResource(R.string.community_search_posts)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { actions.searchPosts() }),
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = actions::searchPosts) {
            Icon(Icons.Filled.Search, contentDescription = stringResource(R.string.community_search_posts))
        }
    }
}

/**
 * The community's feed: the box to write a post in for a member who may, then the posts newest first, each
 * reportable, openable and (this account's own) deletable through the callbacks.
 */
@Composable
private fun ColumnScope.Feed(
    state: CommunityViewModel.State,
    actions: CommunityActions,
    onManage: () -> Unit,
    onReport: (String) -> Unit,
    onDelete: (String) -> Unit,
    onInfo: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.weight(1f),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem) { actions.retry() } } }
        state.community?.let { community ->
            item(key = "about") {
                About(community, state, actions, onManage, onInfo)
            }
        }
        if (state.writes) {
            item(key = "composer") { ComposerPillOrBox(state, actions) }
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
                onReact = { actions.react(post.postId, it) },
                onReport = { onReport(post.postId) },
                onOpen = { actions.open(post.postId) },
                onDelete = { onDelete(post.postId) }.takeIf { post.author.accountId == state.me },
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
) {
    var composing by rememberSaveable { mutableStateOf(false) }
    val empty = state.draft.isEmpty() && state.images.isEmpty() && state.imageNotice == null
    if (composing || !empty) {
        PostComposer(state, actions)
    } else {
        SocialCard(modifier = Modifier.clickable(role = Role.Button) { composing = true }) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    text = stringResource(R.string.post_compose_prompt),
                    color = Palette.mutedFg,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.weight(1f),
                )
                IconButton(
                    onClick = {
                        composing = true
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

/**
 * The community's line and description, the description clamped with a way to read the rest of a long one,
 * what this account may do about joining, and the one button to the tools a moderator and the owner share.
 */
@Composable
private fun About(
    community: Community,
    state: CommunityViewModel.State,
    actions: CommunityActions,
    onManage: () -> Unit,
    onInfo: () -> Unit,
) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        CommunityLine(community, onInfo)
        Description(community.description, expanded) {
            expanded = true
            onInfo()
        }
        JoinPart(community, state, actions)
        if (community.moderates) {
            val count = (community.openReports ?: 0uL) + (community.pendingJoinRequests ?: 0uL)
            OutlinedButton(
                onClick = onManage,
                enabled = !state.busy,
                modifier = Modifier.heightIn(min = 44.dp),
            ) {
                Text(
                    if (count > 0uL) {
                        stringResource(R.string.community_manage_count, count.toInt())
                    } else {
                        stringResource(R.string.community_manage)
                    },
                )
            }
        }
        if (state.muted) Muted(stringResource(R.string.community_muted))
    }
}

/** A community's description: a long one clamped to [DESCRIPTION_LINES] lines until its reader asks for more. */
@Composable
private fun Description(
    text: String,
    expanded: Boolean,
    onReadMore: () -> Unit,
) {
    if (text.isBlank()) return
    val long = text.length > DESCRIPTION_CHARS || text.contains('\n')
    val clamped = long && !expanded
    Text(
        text = text,
        style = MaterialTheme.typography.bodyLarge,
        maxLines = if (clamped) DESCRIPTION_LINES else Int.MAX_VALUE,
        overflow = if (clamped) TextOverflow.Ellipsis else TextOverflow.Clip,
    )
    if (clamped) {
        TextButton(onClick = onReadMore) { Text(stringResource(R.string.community_read_more)) }
    }
}

@Composable
internal fun Muted(text: String) {
    Text(text = text, style = MaterialTheme.typography.bodyMedium, color = Palette.mutedFg)
}

/** Joining, asking again after a decline, waiting for an answer, or leaving: whichever applies to this account. */
@Composable
private fun JoinPart(
    community: Community,
    state: CommunityViewModel.State,
    actions: CommunityActions,
) {
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
        community.role == null && state.declinedUntil != null ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Muted(stringResource(R.string.community_join_declined))
                Muted(stringResource(R.string.community_join_again, calendarDate(state.declinedUntil)))
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
}

@Composable
private fun ReportPostDialog(
    postId: String,
    actions: CommunityActions,
    onDismiss: () -> Unit,
) {
    ReportDialog(
        onSend = { reason, note -> actions.report(ReportTarget(ReportTargetKind.POST, postId), reason, note) },
        onDismiss = onDismiss,
    )
}

/** A description longer than this many characters, or in several lines, is clamped until it is read in full. */
private const val DESCRIPTION_CHARS = 140

/** How many lines a clamped description shows before its reader asks for more. */
private const val DESCRIPTION_LINES = 3
