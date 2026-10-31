package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.PostTarget
import samtak.spjall.core.WallAudience
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard

/** The test tags of the feed's composer: the prompt that opens it, the target row and its entries, the switch. */
internal const val FEED_COMPOSE_PROMPT = "feed-compose-prompt"
internal const val FEED_COMPOSER = "feed-composer"
internal const val FEED_TARGET = "feed-target"
internal const val FEED_WALL_TARGET = "feed-target-wall"
internal const val FEED_ANONYMOUS = "feed-anonymous"

/** The full-width prompt at the top of the list; a tap opens [FeedComposerSheet]. */
@Composable
internal fun ComposePrompt(onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = !suspended(),
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(FEED_COMPOSE_PROMPT),
    ) { Text(stringResource(R.string.post_compose_prompt)) }
}

/**
 * The composer of the feed (decision 0116) in a sheet: the words, the images and the poll, one row that picks where
 * the post goes, and what that place takes: the audience and the not-encrypted line for the wall, the anonymous
 * switch for a community that allows it. Dismissing keeps the draft in the view model.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FeedComposerSheet(
    state: FeedViewModel.State,
    attached: Attached,
    actions: FeedActions,
) {
    // Opened whole: the send button is at the foot, and a half-open sheet would hide it.
    ModalBottomSheet(
        onDismissRequest = actions::closeComposer,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Palette.surface,
    ) {
        Column(
            modifier = Modifier.navigationBarsPadding().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // A refusal shows here too: the list behind the sheet is out of sight.
            state.problem?.let { ProblemCard(it, actions::retry) }
            Composer(
                label = stringResource(R.string.post_compose_prompt),
                action = stringResource(R.string.post_publish),
                text = state.draft,
                sending = state.publishing,
                onText = actions::draft,
                onSend = actions::publish,
                modifier = Modifier.testTag(FEED_COMPOSER),
                ready = attached.postable(state.draft) && state.offers(state.target),
            ) {
                val off = state.publishing || suspended()
                ComposerAttachments(attached.picked, attached.poll, attached.notice, off, actions)
                TargetRow(state, actions)
                TargetOptions(state, actions)
            }
        }
    }
}

/** One row naming where the post goes, which opens the places: the own wall, then each community offered. */
@Composable
private fun TargetRow(
    state: FeedViewModel.State,
    actions: FeedActions,
) {
    var open by remember { mutableStateOf(false) }
    val wall = stringResource(R.string.feed_target_wall)
    val target = state.target
    val chosen = state.communities.firstOrNull { it.communityId == (target as? PostTarget.Community)?.communityId }
    Text(stringResource(R.string.feed_compose_target), style = MaterialTheme.typography.labelMedium)
    Box {
        OutlinedButton(
            onClick = { open = true },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(FEED_TARGET),
        ) { Text(chosen?.name ?: wall, modifier = Modifier.weight(1f)) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(wall) },
                onClick = {
                    open = false
                    if (target !is PostTarget.Wall) actions.audience(WallAudience.FRIENDS)
                },
                modifier = Modifier.testTag(FEED_WALL_TARGET),
            )
            state.communities.forEach { community ->
                DropdownMenuItem(
                    text = { Text(community.name) },
                    onClick = {
                        open = false
                        actions.target(PostTarget.Community(community.communityId, anonymous = false))
                    },
                    modifier = Modifier.testTag("feed-target-${community.communityId}"),
                )
            }
        }
    }
}

/** What the place takes: the wall its audience and the not-encrypted line, a community the anonymous switch. */
@Composable
private fun TargetOptions(
    state: FeedViewModel.State,
    actions: FeedActions,
) {
    when (val target = state.target) {
        is PostTarget.Wall -> {
            AudienceChips(target.audience, actions::audience)
            Muted(stringResource(R.string.wall_not_encrypted_notice))
        }
        is PostTarget.Community -> {
            if (state.communities.firstOrNull { it.communityId == target.communityId }?.anonymousPosts == true) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Switch(
                        checked = target.anonymous,
                        onCheckedChange = actions::anonymous,
                        modifier = Modifier.testTag(FEED_ANONYMOUS),
                    )
                    Text(stringResource(R.string.composer_anonymous), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}
