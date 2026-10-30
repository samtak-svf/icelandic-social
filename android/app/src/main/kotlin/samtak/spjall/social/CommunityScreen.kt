package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.semantics.contentDescription
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
import samtak.spjall.ui.CommunityLayout
import samtak.spjall.ui.ManageLayout
import samtak.spjall.ui.Palette
import samtak.spjall.ui.calendarDate
import samtak.spjall.ui.currentLayout

/**
 * One community: its name, audience and description, joining or leaving, the box to post in for a member who is
 * not muted, then its posts, newest first.
 */
@Composable
fun CommunityScreen(
    state: CommunityViewModel.State,
    actions: CommunityActions,
) = CommunityScreen(state, actions, ManageSlots())

/** [CommunityScreen] with the views of the two parts of Stjórna that have a view model of their own. */
@Composable
internal fun CommunityScreen(
    state: CommunityViewModel.State,
    actions: CommunityActions,
    slots: ManageSlots,
) {
    // The post being reported; the dialog closes once the report is sent.
    var reporting by rememberSaveable { mutableStateOf<String?>(null) }
    if (reporting in state.reported) reporting = null
    // This account's own post it asked to delete, until it confirms or cancels.
    var deleting by rememberSaveable { mutableStateOf<String?>(null) }
    // The community dialog open, if any.
    var dialog by rememberSaveable { mutableStateOf<CommunityDialog?>(null) }
    var searchVisible by rememberSaveable { mutableStateOf(false) }
    // Stjórna as a page of its own (an expanded window); a narrower one opens it as a dialog.
    var managePage by rememberSaveable { mutableStateOf(false) }
    // The composer opened before anything is written in it.
    var composing by rememberSaveable { mutableStateOf(false) }
    val layout = currentLayout()
    val managing = managePage && layout.manage == ManageLayout.SIDE_NAV && state.community != null
    // The scroll position and the open composer are held here, above the layouts, so a change of size class keeps
    // the reader's place: the feed moves into another pane there, and what it remembered itself would be lost.
    val listState = rememberLazyListState()
    val openInfo = {
        dialog = CommunityDialog.INFO
        if (state.members.isEmpty()) actions.loadMembers()
    }
    val callbacks =
        FeedCallbacks(
            onManage = {
                if (layout.manage == ManageLayout.SIDE_NAV) managePage = true else dialog = CommunityDialog.MANAGE
            },
            onReport = { reporting = it },
            onDelete = { deleting = it },
            onInfo = openInfo,
            onCompose = { composing = true },
        )
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(SUB_SCREEN_SIDES))) {
            SubHeader(state.community?.name.orEmpty(), if (managing) ({ managePage = false }) else actions::back) {
                IconButton(onClick = { searchVisible = !searchVisible }) {
                    Icon(Icons.Filled.Search, contentDescription = stringResource(R.string.community_search_posts))
                }
                IconButton(onClick = openInfo) {
                    Icon(AppIcons.Info, contentDescription = stringResource(R.string.community_info))
                }
            }
            if (searchVisible) SearchRow(state.searchQuery, actions)
            if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            CommunityBody(state, actions, slots, managing, onDeleteCommunity = { dialog = CommunityDialog.DELETE }) {
                Feed(it, state, actions, listState, composing, callbacks)
            }
        }
    }
    reporting?.let { postId -> ReportPostDialog(postId, actions) { reporting = null } }
    CommunityDialogs(state, actions, dialog) { dialog = it }
    deleting?.let { postId ->
        ConfirmDelete(R.string.post_delete_confirm, onDelete = { actions.delete(postId) }) { deleting = null }
    }
}

/**
 * What sits under the header: Stjórna as a page (an expanded window), the feed with `community_info` beside it (an
 * expanded window), or the feed alone. [feed] draws the feed into the modifier it is given.
 */
@Composable
private fun ColumnScope.CommunityBody(
    state: CommunityViewModel.State,
    actions: CommunityActions,
    slots: ManageSlots,
    managing: Boolean,
    onDeleteCommunity: () -> Unit,
    feed: @Composable (Modifier) -> Unit,
) {
    val community = state.community
    when {
        managing && community != null ->
            ManagePage(
                community = community,
                state = state,
                actions = actions,
                slots = slots,
                onDelete = onDeleteCommunity,
                modifier = Modifier.weight(1f),
            )
        // The feed in the main pane, `community_info` in the supporting pane (decision 0087).
        currentLayout().community == CommunityLayout.FEED_AND_ASIDE && community != null -> {
            val modifier = Modifier.weight(1f).fillMaxWidth()
            CommunityPanes(community, state.members, modifier, state.featured, actions::open, feed)
        }
        else -> feed(Modifier.weight(1f))
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
 * The community's line and description, the description clamped with a way to read the rest of a long one,
 * what this account may do about joining, and the one button to the tools a moderator and the owner share.
 */
@Composable
internal fun About(
    community: Community,
    state: CommunityViewModel.State,
    actions: CommunityActions,
    onManage: () -> Unit,
    onInfo: () -> Unit,
) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    // The people the picture row shows are read once, for a community this account may read.
    LaunchedEffect(community.communityId, community.reads) {
        if (community.reads && state.members.isEmpty()) actions.loadMembers()
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        CommunityHeader(community, state.members, onInfo)
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
