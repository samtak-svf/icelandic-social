package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.PersonProfile
import samtak.spjall.core.PostImage
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.ReportTargetKind
import samtak.spjall.core.WallAudience
import samtak.spjall.limits.Limits
import samtak.spjall.me.Confirm
import samtak.spjall.ui.Dates
import samtak.spjall.ui.Palette
import samtak.spjall.ui.fitsIn
import java.time.YearMonth
import java.time.format.TextStyle

// The tabs of a wall (decision 0115) and the menu a person's screen has.

private const val BIO_MAX = Limits.BIO_CHARS
private const val GRID_COLUMNS = 3
private const val GRID_GAP = 4

/** `YYYY-MM` as the month's name and the year. */
internal fun monthName(month: String): String =
    runCatching {
        val parsed = YearMonth.parse(month)
        "${parsed.month.getDisplayName(TextStyle.FULL_STANDALONE, Dates.ICELANDIC)} ${parsed.year}"
    }.getOrDefault(month)

/** The three tabs and the one that is open. */
internal fun LazyListScope.wallTabs(
    profile: PersonProfile,
    state: PersonViewModel.State,
    attached: Attached,
    own: Boolean,
    actions: PersonActions,
    reportPost: (String) -> Unit,
) {
    item(key = "tabs") {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            WallTab.entries.forEach { tab ->
                FilterChip(
                    selected = state.tab == tab,
                    onClick = { actions.selectTab(tab) },
                    label = {
                        Text(
                            stringResource(
                                when (tab) {
                                    WallTab.POSTS -> R.string.wall_tab_posts
                                    WallTab.ABOUT -> R.string.wall_tab_about
                                    WallTab.IMAGES -> R.string.wall_tab_images
                                },
                            ),
                        )
                    },
                    modifier = Modifier.heightIn(min = 48.dp).testTag("wall-tab-${tab.name}"),
                )
            }
        }
    }
    when (state.tab) {
        WallTab.POSTS -> postsTab(state, attached, own, actions, reportPost)
        WallTab.ABOUT -> aboutTab(profile, state, own, actions)
        WallTab.IMAGES -> imagesTab(state, actions)
    }
}

private fun LazyListScope.postsTab(
    state: PersonViewModel.State,
    attached: Attached,
    own: Boolean,
    actions: PersonActions,
    reportPost: (String) -> Unit,
) {
    if (own) item(key = "composer") { WallComposer(state, attached, actions) }
    if (state.loaded && state.posts.isEmpty()) item(key = "posts-empty") { Muted(stringResource(R.string.posts_empty)) }
    items(state.posts.size, key = { "post-${state.posts[it].postId}" }) { index ->
        val post = state.posts[index]
        PostCard(
            post = post,
            reacting = false,
            reported = post.postId in state.reportedPosts,
            callbacks =
                PostCardCallbacks(
                    onReact = { actions.react(post.postId, it) },
                    onReport = { reportPost(post.postId) },
                    onOpen = { actions.openPost(post.postId) },
                    onComment = { actions.openPost(post.postId) },
                    onDelete = { actions.deletePost(post.postId) }.takeIf { post.mine },
                    poll = actions.callbacksFor(post.postId, mayClose = post.mine),
                    answering = post.postId in state.answering,
                ),
        )
        if (own && post.audience != null) {
            AudienceMenu(post.audience!!, "audience-${post.postId}") { actions.postAudience(post.postId, it) }
        }
        if (index == state.posts.lastIndex && state.postsNext != null) {
            LaunchedEffect(state.postsNext) { actions.morePosts() }
        }
    }
}

@Composable
private fun WallComposer(
    state: PersonViewModel.State,
    attached: Attached,
    actions: PersonActions,
) {
    SocialCard {
        Composer(
            label = stringResource(R.string.post_compose_prompt),
            action = stringResource(R.string.post_publish),
            text = state.draft,
            sending = state.publishing,
            onText = actions::draft,
            onSend = actions::publish,
            modifier = Modifier.testTag("wall-composer"),
            ready = attached.postable(state.draft),
        ) {
            ComposerAttachments(
                attached.picked,
                attached.poll,
                attached.notice,
                state.publishing || suspended(),
                actions,
            )
            Text(stringResource(R.string.wall_audience_label), style = MaterialTheme.typography.labelMedium)
            AudienceChips(state.audience, actions::audience)
            Muted(stringResource(R.string.wall_not_encrypted_notice))
        }
    }
}

internal fun audienceLabel(audience: WallAudience) =
    when (audience) {
        WallAudience.FRIENDS -> R.string.wall_audience_friends
        WallAudience.EVERYONE -> R.string.wall_audience_everyone
    }

/** Who may read a post, and the way to change it. */
@Composable
private fun AudienceMenu(
    audience: WallAudience,
    tag: String,
    onChange: (WallAudience) -> Unit,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    // A suspended account may not change who reads a post (0115).
    if (suspended()) return
    Box {
        TextButton(onClick = { open = true }, modifier = Modifier.testTag(tag)) {
            Text(stringResource(audienceLabel(audience)))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            WallAudience.entries.forEach { choice ->
                DropdownMenuItem(
                    text = { Text(stringResource(audienceLabel(choice))) },
                    onClick = {
                        open = false
                        if (choice != audience) onChange(choice)
                    },
                    modifier = Modifier.testTag("$tag-${choice.name}"),
                )
            }
        }
    }
}

private fun LazyListScope.aboutTab(
    profile: PersonProfile,
    state: PersonViewModel.State,
    own: Boolean,
    actions: PersonActions,
) {
    if (own) {
        item(key = "bio") { BioEditor(state.wall?.bio.orEmpty(), actions) }
        item(key = "cover") { CoverControls(state.wall?.cover != null, actions) }
    }
    if (profile.mutualFriends.isNotEmpty()) item(key = "mutual") { Mutual(profile, actions) }
    if (profile.sharedCommunities.isNotEmpty()) item(key = "communities") { Shared(profile, actions) }
}

@Composable
private fun BioEditor(
    saved: String,
    actions: PersonActions,
) {
    var text by rememberSaveable(saved) { mutableStateOf(saved) }
    val tooLong = !text.fitsIn(BIO_MAX)
    // A suspended account may clear the bio, not write it (0115).
    val clearOnly = suspended()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            label = { Text(stringResource(R.string.wall_bio_label)) },
            placeholder = { Text(stringResource(R.string.wall_bio_placeholder)) },
            isError = tooLong,
            supportingText = { if (tooLong) Text(stringResource(R.string.wall_bio_too_long)) },
            modifier = Modifier.fillMaxWidth().testTag("bio"),
        )
        OutlinedButton(
            onClick = { actions.saveBio(text) },
            enabled = !tooLong && text.trim() != saved && (!clearOnly || text.isBlank()),
            modifier = Modifier.heightIn(min = 48.dp).testTag("bio-save"),
        ) { Text(stringResource(R.string.save)) }
    }
}

@Composable
private fun CoverControls(
    hasCover: Boolean,
    actions: PersonActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // A suspended account may take the cover off, not put one on (0115).
        val removeOnly = suspended()
        if (!removeOnly) {
            OutlinedButton(
                onClick = actions::chooseCover,
                modifier = Modifier.heightIn(min = 48.dp).testTag("cover-choose"),
            ) { Text(stringResource(R.string.community_cover_choose)) }
        }
        if (hasCover) {
            if (!removeOnly) {
                OutlinedButton(onClick = actions::reframeCover, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.image_frames_title))
                }
            }
            OutlinedButton(
                onClick = actions::removeCover,
                modifier = Modifier.heightIn(min = 48.dp).testTag("cover-remove"),
            ) { Text(stringResource(R.string.community_cover_remove)) }
        }
    }
}

private fun LazyListScope.imagesTab(
    state: PersonViewModel.State,
    actions: PersonActions,
) {
    if (state.imagesLoaded && state.images.isEmpty()) {
        item(key = "images-empty") { Muted(stringResource(R.string.community_images_empty)) }
    }
    val rows = state.images.chunked(GRID_COLUMNS)
    rows.forEachIndexed { index, row ->
        item(key = "images-row-${row.first().mediaId}") {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(GRID_GAP.dp)) {
                row.forEach { image ->
                    PostImageView(
                        image.postId,
                        PostImage(image.mediaId, image.width, image.height),
                        stringResource(R.string.post_image_alt),
                        Modifier.weight(1f).aspectRatio(1f),
                    ) { actions.openPost(image.postId) }
                }
                repeat(GRID_COLUMNS - row.size) { Box(Modifier.weight(1f)) }
            }
            if (index == rows.lastIndex && state.imagesNext != null) {
                LaunchedEffect(state.imagesNext) { actions.moreImages() }
            }
        }
    }
}

/** The menu of another account's screen: report and block (0114). */
@Composable
internal fun PersonMenu(
    profile: PersonProfile,
    actions: PersonActions,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    var reporting by rememberSaveable { mutableStateOf(false) }
    var blocking by rememberSaveable { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }, modifier = Modifier.testTag("person-menu")) {
            Icon(Icons.Filled.MoreVert, stringResource(R.string.notice_menu))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.report)) },
                onClick = {
                    open = false
                    reporting = true
                },
                modifier = Modifier.testTag("person-report"),
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.block), color = Palette.danger) },
                onClick = {
                    open = false
                    blocking = true
                },
                modifier = Modifier.testTag("person-block"),
            )
        }
    }
    if (reporting) {
        ReportDialog(
            onSend = { reason, note ->
                reporting = false
                actions.report(ReportTarget(ReportTargetKind.ACCOUNT, profile.accountId), reason, note)
            },
            onDismiss = { reporting = false },
        )
    }
    if (blocking) {
        Confirm(
            text = stringResource(R.string.block_confirm, profile.name ?: stringResource(R.string.person_unnamed)),
            confirm = stringResource(R.string.block),
            onConfirm = {
                blocking = false
                actions.block()
            },
            onDismiss = { blocking = false },
        )
    }
}
