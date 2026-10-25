package samtak.spjall.social

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
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
import samtak.spjall.core.Post
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.FeaturedLayout
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.currentLayout

/**
 * The community's feed: the box to write a post in for a member who may, then the posts newest first, each
 * reportable, openable and (this account's own) deletable through the callbacks.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun Feed(
    modifier: Modifier,
    state: CommunityViewModel.State,
    actions: CommunityActions,
    listState: LazyListState,
    composing: Boolean,
    callbacks: FeedCallbacks,
) {
    val shown = state.shownTab()
    val strip = currentLayout().featured == FeaturedLayout.STRIP
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
            if (community.reads) {
                stickyHeader(key = "tabs") {
                    CommunityTabRow(state.visibleTabs(), shown, actions::selectTab)
                }
            }
        }
        when (shown) {
            CommunityTab.DISCUSSION -> discussionTab(state, actions, composing, strip, callbacks)
            CommunityTab.FEATURED -> postItems(state, state.featured, actions, callbacks, "featured")
            CommunityTab.IMAGES -> imagesTab(state, actions)
            CommunityTab.MEMBERS ->
                items(state.members, key = { "member-${it.accountId}" }) { CommunityMemberRow(it) }
            CommunityTab.ABOUT ->
                state.community?.let { community ->
                    item(key = "about-facts") {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            AboutFacts(community, state.members)
                        }
                    }
                }
        }
    }
}

/**
 * Umræða: the composer, the featured strip (compact and medium windows), then the posts newest first. On an
 * expanded window the featured posts are in the aside, so the feed leaves them out unless a search is typed
 * (decision 0092); on the others the feed is complete.
 */
private fun LazyListScope.discussionTab(
    state: CommunityViewModel.State,
    actions: CommunityActions,
    composing: Boolean,
    strip: Boolean,
    callbacks: FeedCallbacks,
) {
    if (state.writes) {
        item(key = "composer") { ComposerPillOrBox(state, actions, composing, callbacks.onCompose) }
    }
    if (state.featured.isNotEmpty() && strip) {
        item(key = "featured-strip") { FeaturedStrip(state.featured, actions::open) }
    }
    if (state.loaded && state.community?.reads == true && state.posts.isEmpty()) {
        val emptyText =
            if (state.searchQuery.isNotBlank()) R.string.community_search_empty else R.string.posts_empty
        item(key = "empty") { Muted(stringResource(emptyText)) }
    }
    val feed = feedPosts(state.posts, state.featured, strip, state.searchQuery.isNotBlank())
    postItems(state, feed, actions, callbacks, "post", paged = true)
}

/**
 * The posts the Umræða feed draws (decision 0092). With the featured posts in the aside (`!strip`) they are
 * left out by the community's `featured` list, not by `Post.pinned`, so a released post is back as soon as the
 * list changes; the strip layouts and a search keep the feed complete.
 */
internal fun feedPosts(
    posts: List<Post>,
    featured: List<Post>,
    strip: Boolean,
    searching: Boolean,
): List<Post> {
    if (strip || searching || featured.isEmpty()) return posts
    val aside = featured.mapTo(HashSet()) { it.postId }
    return posts.filter { it.postId !in aside }
}

/** [posts] as cards; the feed asks for its next page when its last card is drawn. */
private fun LazyListScope.postItems(
    state: CommunityViewModel.State,
    posts: List<Post>,
    actions: CommunityActions,
    callbacks: FeedCallbacks,
    prefix: String,
    paged: Boolean = false,
) {
    val moderates = state.community?.moderates == true
    itemsIndexed(posts, key = { _, item -> "$prefix-${item.postId}" }) { index, post ->
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
                    onPin = { pinned: Boolean -> actions.pin(post.postId, pinned) }.takeIf { moderates },
                    onSendToConversation = { actions.sendToConversation(post.postId) },
                    poll = actions.callbacksFor(post.postId, mayClose = post.mine || moderates),
                    answering = post.postId in state.answering,
                    onReveal = { actions.revealAuthor(post.postId) }.takeIf { moderates },
                    revealed = state.revealed[post.postId],
                ),
        )
        if (paged && index == posts.lastIndex && state.next != null) {
            LaunchedEffect(state.next) { actions.more() }
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
    ) { ComposerExtras(state, actions) }
}

/** What goes with the post's text: its images or its poll, and the anonymous switch where the community allows it. */
@Composable
private fun ComposerExtras(
    state: CommunityViewModel.State,
    actions: CommunityActions,
) {
    val poll = state.poll
    if (poll != null) PollFields(poll, actions) else ImagesPicked(state, actions)
    if (state.images.isEmpty()) {
        OutlinedButton(
            onClick = actions::togglePoll,
            enabled = !state.publishing,
            modifier = Modifier.heightIn(min = 44.dp),
        ) { Text(stringResource(R.string.composer_poll)) }
    }
    if (state.community?.anonymousPosts == true) {
        AnonymousSwitch(state.anonymous, !state.publishing, actions::setAnonymous)
    }
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
