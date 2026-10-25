package samtak.spjall.social

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Post
import samtak.spjall.core.PostImage
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.Palette
import samtak.spjall.ui.TabsLayout
import samtak.spjall.ui.currentLayout
import samtak.spjall.ui.photoOf

/** The test tag of the tab row, of each tab (suffixed with its name), of the featured strip and of the grid. */
internal const val COMMUNITY_TABS = "community-tabs"
internal const val FEATURED_STRIP = "featured-strip"
internal const val IMAGES_GRID = "images-grid"

/** The tabs shown (0089), in order: Fest only while a post is featured. */
internal fun CommunityViewModel.State.visibleTabs(): List<CommunityTab> =
    CommunityTab.entries.filter { it != CommunityTab.FEATURED || featured.isNotEmpty() }

/** The tab being shown: a community this account cannot read has no tabs, and Fest is gone once nothing is featured. */
internal fun CommunityViewModel.State.shownTab(): CommunityTab =
    if (community?.reads != true || tab !in visibleTabs()) CommunityTab.DISCUSSION else tab

private fun CommunityTab.label(): Int =
    when (this) {
        CommunityTab.DISCUSSION -> R.string.community_tab_discussion
        CommunityTab.FEATURED -> R.string.community_tab_featured
        CommunityTab.IMAGES -> R.string.community_tab_images
        CommunityTab.MEMBERS -> R.string.community_tab_members
        CommunityTab.ABOUT -> R.string.community_tab_about
    }

/**
 * The community's tab row (decision 0089): it scrolls sideways when the window is narrow and lies in one row from
 * the medium size class on ([TabsLayout]).
 */
@Composable
internal fun CommunityTabRow(
    tabs: List<CommunityTab>,
    selected: CommunityTab,
    onSelect: (CommunityTab) -> Unit,
) {
    val scrolls = currentLayout().tabs == TabsLayout.SCROLL
    val name = stringResource(R.string.community_tabs)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(Palette.bg)
                .then(if (scrolls) Modifier.horizontalScroll(rememberScrollState()) else Modifier)
                .testTag(COMMUNITY_TABS)
                .semantics { contentDescription = name },
    ) {
        tabs.forEach { tab ->
            val on = tab == selected
            Column(
                modifier =
                    (if (scrolls) Modifier else Modifier.weight(1f))
                        .heightIn(min = 48.dp)
                        .selectable(selected = on, role = Role.Tab) { onSelect(tab) }
                        .testTag("$COMMUNITY_TABS-${tab.name}"),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    text = stringResource(tab.label()),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
                    color = if (on) Palette.fg else Palette.mutedFg,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                )
                Box(Modifier.fillMaxWidth().heightIn(min = 2.dp).background(if (on) Palette.primary else Palette.bg))
            }
        }
    }
}

/** One featured card (decision 0088): the first image or the author's picture, the first lines, the author. */
@Composable
internal fun FeaturedCard(
    post: Post,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    SocialCard(modifier = modifier.clickable(role = Role.Button, onClick = onOpen)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val first = post.images.firstOrNull()
            if (first != null) {
                PostImageView(post.postId, first, stringResource(R.string.post_image_alt), Modifier.size(THUMB.dp))
            } else {
                Avatar(
                    name = post.author?.name,
                    kind = if (post.author?.verified == true) AvatarKind.Verified else AvatarKind.Unverified,
                    size = THUMB.dp,
                    photo = post.author?.photoOf(),
                )
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = post.body,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = post.anonymousBylineRes()?.let { stringResource(it) } ?: post.author?.shownName().orEmpty(),
                    style = MaterialTheme.typography.bodySmall,
                    color = Palette.mutedFg,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** The row of featured posts between the composer and the feed (compact and medium windows). */
@Composable
internal fun FeaturedStrip(
    featured: List<Post>,
    onOpen: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag(FEATURED_STRIP)) {
        Text(
            stringResource(R.string.community_featured),
            style = MaterialTheme.typography.titleSmall,
            modifier = Modifier.semantics { heading() },
        )
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            featured.forEach { FeaturedCard(it, { onOpen(it.postId) }, Modifier.width(STRIP_CARD.dp)) }
        }
    }
}

/** The same cards stacked under Fest in the aside (an expanded window). */
@Composable
internal fun FeaturedList(
    featured: List<Post>,
    onOpen: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag(FEATURED_STRIP)) {
        Text(
            stringResource(R.string.community_featured),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.semantics { heading() },
        )
        featured.forEach { FeaturedCard(it, { onOpen(it.postId) }) }
    }
}

/** Myndir: the community's pictures as a grid three across, newest first; a tap opens the post. */
internal fun LazyListScope.imagesTab(
    state: CommunityViewModel.State,
    actions: CommunityActions,
) {
    if (state.galleryLoaded && state.gallery.isEmpty()) {
        item(key = "images-empty") { Muted(stringResource(R.string.community_images_empty)) }
    }
    val rows = state.gallery.chunked(GRID_COLUMNS)
    rows.forEachIndexed { index, row ->
        item(key = "images-row-${row.first().mediaId}") {
            Row(
                modifier = Modifier.fillMaxWidth().testTag(IMAGES_GRID),
                horizontalArrangement = Arrangement.spacedBy(GRID_GAP.dp),
            ) {
                row.forEach { image ->
                    PostImageView(
                        image.postId,
                        PostImage(image.mediaId, image.width, image.height),
                        stringResource(R.string.post_image_alt),
                        Modifier.weight(1f).aspectRatio(1f),
                    ) { actions.open(image.postId) }
                }
                repeat(GRID_COLUMNS - row.size) { Box(Modifier.weight(1f)) }
            }
            if (index == rows.lastIndex && state.galleryNext != null) {
                LaunchedEffect(state.galleryNext) { actions.moreGallery() }
            }
        }
    }
}

private const val THUMB = 64
private const val STRIP_CARD = 280
private const val GRID_COLUMNS = 3
private const val GRID_GAP = 4
