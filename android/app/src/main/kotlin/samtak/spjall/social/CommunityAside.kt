package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.layout.AnimatedPane
import androidx.compose.material3.adaptive.navigation.NavigableSupportingPaneScaffold
import androidx.compose.material3.adaptive.navigation.rememberSupportingPaneScaffoldNavigator
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityMember
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.Palette
import samtak.spjall.ui.currentLayout

/** The test tag of the aside. */
internal const val COMMUNITY_ASIDE = "community-aside"

/**
 * What Um samfélagið holds, in the form both the dialog and the aside show it: the description, the audience with
 * the count of members, and the sentence that the content is not end-to-end encrypted.
 */
@Composable
internal fun AboutFacts(
    community: Community,
    members: List<CommunityMember>,
) {
    val audience =
        stringResource(
            if (community.audience == CommunityAudience.OPEN) R.string.community_open else R.string.community_private,
        )
    val memberCount = community.memberCount?.toInt() ?: members.size
    Text(community.description, style = MaterialTheme.typography.bodyLarge)
    Text(
        "$audience · ${pluralStringResource(R.plurals.community_members, memberCount, memberCount)}",
        style = MaterialTheme.typography.bodyMedium,
    )
    Muted(stringResource(R.string.community_not_encrypted_notice))
}

/**
 * The community page on an expanded window (decision 0087): a supporting-pane layout with the feed as the main pane
 * and Um samfélagið as the supporting one, so a foldable that unfolds changes layout without a restart. [feed]
 * draws the feed into the modifier it is given.
 */
@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
internal fun CommunityPanes(
    community: Community,
    members: List<CommunityMember>,
    modifier: Modifier = Modifier,
    feed: @Composable (Modifier) -> Unit,
) {
    val navigator = rememberSupportingPaneScaffoldNavigator<Nothing>()
    NavigableSupportingPaneScaffold(
        navigator = navigator,
        modifier = modifier,
        mainPane = {
            AnimatedPane {
                // The feed keeps a readable line length, centred in the pane.
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                    feed(Modifier.widthIn(max = FEED_WIDTH.dp).fillMaxHeight())
                }
            }
        },
        supportingPane = { AnimatedPane { CommunityAside(community, members, Modifier.fillMaxHeight()) } },
    )
}

/** The widest the feed is drawn, so a line of text stays readable. */
private const val FEED_WIDTH = 640

/**
 * Um samfélagið beside the feed on an expanded window (decision 0087): the facts and the first members' pictures.
 * It scrolls on its own, so it stays in view while the feed moves.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CommunityAside(
    community: Community,
    members: List<CommunityMember>,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.verticalScroll(rememberScrollState()).padding(16.dp).testTag(COMMUNITY_ASIDE),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            stringResource(R.string.community_info),
            style = MaterialTheme.typography.titleLarge,
            color = Palette.fg,
            modifier = Modifier.semantics { heading() },
        )
        AboutFacts(community, members)
        if (members.isNotEmpty()) {
            Text(
                stringResource(R.string.community_members_title),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.semantics { heading() },
            )
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                members.take(currentLayout().memberPictures).forEach { Avatar(it, size = 40.dp) }
            }
        }
    }
}
