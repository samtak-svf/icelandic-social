package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.ui.CreateLayout
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.currentLayout

/** `community_create`: a name, a description, and whether anyone may read and join it or only those let in. */
@Composable
fun CreateCommunityScreen(
    state: CreateCommunityViewModel.State,
    actions: CreateCommunityActions,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(SUB_SCREEN_SIDES))) {
            SubHeader(stringResource(R.string.community_create), actions::back)
            SuspendedNotice()
            if (currentLayout().create == CreateLayout.FORM_AND_PREVIEW) {
                // The form beside a live preview of the header the community will have (decision 0087).
                Row(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    CreateForm(state, actions, Modifier.weight(1f).fillMaxHeight())
                    CommunityPreview(state, Modifier.weight(1f).fillMaxHeight())
                }
            } else {
                CreateForm(state, actions, Modifier.weight(1f))
            }
        }
    }
}

/** The test tag of the preview. */
internal const val COMMUNITY_PREVIEW = "community-preview"

/** The header the community will have, drawn by the one the community screen draws, from what is typed so far. */
@Composable
private fun CommunityPreview(
    state: CreateCommunityViewModel.State,
    modifier: Modifier = Modifier,
) {
    val community =
        Community(
            communityId = "preview",
            name = state.name.ifBlank { stringResource(R.string.community_name) },
            description = state.description,
            audience = state.audience,
            createdAt = 0uL,
            memberCount = 1uL,
            role = null,
            joinRequested = false,
            invited = false,
            mutedUntil = null,
            readOnly = false,
            deletedAt = null,
            joinDeclinedUntil = null,
            pendingJoinRequests = null,
            unread = 0uL,
            pinned = false,
            lastPostAt = null,
        )
    Column(
        modifier = modifier.verticalScroll(rememberScrollState()).padding(16.dp).testTag(COMMUNITY_PREVIEW),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        CommunityHeader(community, emptyList(), onInfo = {})
        if (community.description.isNotBlank()) Text(community.description, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun CreateForm(
    state: CreateCommunityViewModel.State,
    actions: CreateCommunityActions,
    modifier: Modifier,
) {
    Column(
        modifier = modifier.verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        state.problem?.let { ProblemCard(it, actions::create) }
        OutlinedTextField(
            value = state.name,
            onValueChange = actions::name,
            label = { Text(stringResource(R.string.community_name)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = state.description,
            onValueChange = actions::description,
            label = { Text(stringResource(R.string.community_description)) },
            minLines = 3,
            modifier = Modifier.fillMaxWidth(),
        )
        PictureRows(state, actions)
        Column(modifier = Modifier.selectableGroup()) {
            Audience(CommunityAudience.OPEN, R.string.community_open, R.string.community_open_hint, state, actions)
            Audience(
                CommunityAudience.PRIVATE,
                R.string.community_private,
                R.string.community_private_hint,
                state,
                actions,
            )
        }
        Button(
            onClick = actions::create,
            enabled = state.ready && !suspended(),
            modifier = Modifier.align(Alignment.End).heightIn(min = 44.dp),
        ) { Text(stringResource(R.string.community_create)) }
    }
}

/** Choosing the picture and the cover, each removable until the community is made (0080). */
@Composable
private fun PictureRows(
    state: CreateCommunityViewModel.State,
    actions: CreateCommunityActions,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = actions::pickPicture) { Text(stringResource(R.string.community_picture_choose)) }
        if (state.hasPicture) {
            TextButton(onClick = actions::removePicture) { Text(stringResource(R.string.community_picture_remove)) }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = actions::pickCover) { Text(stringResource(R.string.community_cover_choose)) }
        if (state.hasCover) {
            TextButton(onClick = actions::removeCover) { Text(stringResource(R.string.community_cover_remove)) }
        }
    }
}

@Composable
private fun Audience(
    audience: CommunityAudience,
    label: Int,
    hint: Int,
    state: CreateCommunityViewModel.State,
    actions: CreateCommunityActions,
) {
    val selected = state.audience == audience
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .selectable(selected = selected, role = Role.RadioButton) { actions.audience(audience) }
                .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        RadioButton(selected = selected, onClick = null)
        Column {
            Text(text = stringResource(label), style = MaterialTheme.typography.titleSmall)
            Text(text = stringResource(hint), style = MaterialTheme.typography.bodySmall, color = Palette.mutedFg)
        }
    }
}
