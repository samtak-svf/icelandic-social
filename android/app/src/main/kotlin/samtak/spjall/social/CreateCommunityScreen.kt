package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.CommunityAudience
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard

/** "Stofna samfélag": a name, a description, and whether anyone may read and join it or only those let in. */
@Composable
fun CreateCommunityScreen(
    state: CreateCommunityViewModel.State,
    actions: CreateCommunityActions,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(SUB_SCREEN_SIDES))) {
            SubHeader(stringResource(R.string.community_create), actions::back)
            Column(
                modifier =
                    Modifier
                        .weight(1f)
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
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
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(
                        onClick = actions::pickPicture,
                    ) { Text(stringResource(R.string.community_picture_choose)) }
                    if (state.hasPicture) {
                        TextButton(onClick = actions::removePicture) {
                            Text(stringResource(R.string.community_picture_remove))
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = actions::pickCover) { Text(stringResource(R.string.community_cover_choose)) }
                    if (state.hasCover) {
                        TextButton(onClick = actions::removeCover) {
                            Text(stringResource(R.string.community_cover_remove))
                        }
                    }
                }
                Column(modifier = Modifier.selectableGroup()) {
                    Audience(
                        CommunityAudience.OPEN,
                        R.string.community_open,
                        R.string.community_open_hint,
                        state,
                        actions,
                    )
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
                    enabled = state.ready,
                    modifier = Modifier.align(Alignment.End).heightIn(min = 44.dp),
                ) { Text(stringResource(R.string.community_create)) }
            }
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
