package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import samtak.spjall.brand.R
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityMember
import samtak.spjall.core.CommunityRole
import samtak.spjall.ui.CancelButton
import samtak.spjall.ui.Palette

/** The parts of Stjórna a wide window shows beside each other. */
private enum class Section { EDIT, MEMBERS, LOG }

/** The test tags of the two panes. */
internal const val MANAGE_SECTIONS = "manage-sections"
internal const val MANAGE_DETAIL = "manage-detail"

/**
 * Stjórna on a wide window (decision 0087): the sections in a list on the left, the chosen one beside it. The
 * report queue and the join requests are screens of their own, so choosing one leaves for it as it does on a
 * narrow window; the edit form, the members and the log open here, in place.
 */
@Composable
internal fun ManagePanes(
    community: Community,
    state: CommunityViewModel.State,
    actions: CommunityActions,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    val owner = community.role == CommunityRole.OWNER
    val first =
        when {
            owner -> Section.EDIT
            community.moderates -> Section.LOG
            else -> null
        }
    var chosen by rememberSaveable { mutableStateOf(first) }
    LaunchedEffect(chosen) {
        when (chosen) {
            Section.MEMBERS -> actions.loadMembers()
            Section.LOG -> actions.loadModerationLog()
            else -> Unit
        }
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = Palette.surface,
            contentColor = Palette.fg,
            modifier = Modifier.fillMaxWidth(WIDTH_FRACTION).widthIn(max = MAX_WIDTH.dp).heightIn(max = MAX_HEIGHT.dp),
        ) {
            Row {
                SectionList(community, state.busy, chosen, onChoose = { chosen = it }, actions, onDelete, onDismiss)
                SectionDetail(chosen, community, state, actions, Modifier.weight(1f))
            }
        }
    }
}

/** The left pane: the report queue and the join requests, which leave for their own screens, then the sections. */
@Composable
private fun SectionList(
    community: Community,
    busy: Boolean,
    chosen: Section?,
    onChoose: (Section) -> Unit,
    actions: CommunityActions,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    val owner = community.role == CommunityRole.OWNER
    val waiting = community.pendingJoinRequests?.toInt() ?: 0
    val reports = community.openReports?.toInt() ?: 0
    Column(
        modifier =
            Modifier
                .width(LIST_WIDTH.dp)
                .fillMaxHeight()
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
                .selectableGroup()
                .testTag(MANAGE_SECTIONS),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(stringResource(R.string.community_manage), style = MaterialTheme.typography.headlineSmall)
        SectionItem(
            if (reports > 0) {
                "${stringResource(R.string.moderation_queue)} ($reports)"
            } else {
                stringResource(R.string.moderation_queue)
            },
            selected = false,
        ) {
            onDismiss()
            actions.reports()
        }
        SectionItem(
            if (waiting > 0) {
                pluralStringResource(R.plurals.join_requests_waiting, waiting, waiting)
            } else {
                stringResource(R.string.join_requests_title)
            },
            selected = false,
        ) {
            onDismiss()
            actions.requests()
        }
        if (owner) {
            SectionItem(stringResource(R.string.community_edit), chosen == Section.EDIT) { onChoose(Section.EDIT) }
            SectionItem(stringResource(R.string.community_members_title), chosen == Section.MEMBERS) {
                onChoose(Section.MEMBERS)
            }
        }
        if (community.moderates) {
            SectionItem(stringResource(R.string.moderation_log_title), chosen == Section.LOG) { onChoose(Section.LOG) }
        }
        if (owner) {
            OutlinedButton(
                onClick = onDelete,
                enabled = !busy,
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Palette.danger),
                modifier = Modifier.padding(top = 12.dp).heightIn(min = 44.dp),
            ) { Text(stringResource(R.string.community_delete)) }
        }
        CancelButton(onDismiss)
    }
}

/** The right pane: the section chosen. */
@Composable
private fun SectionDetail(
    chosen: Section?,
    community: Community,
    state: CommunityViewModel.State,
    actions: CommunityActions,
    modifier: Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxHeight()
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
                .testTag(MANAGE_DETAIL),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        when (chosen) {
            Section.EDIT -> {
                val draft = rememberEditDraft(community)
                EditFields(community, state.busy, actions, draft)
                Button(
                    onClick = { draft.save(community, actions) },
                    enabled = !state.busy && draft.name.isNotBlank(),
                ) { Text(stringResource(R.string.save)) }
            }
            Section.MEMBERS -> MembersList(community, state.members, state.busy, actions)
            Section.LOG ->
                if (state.moderationLog.isEmpty()) {
                    Muted(stringResource(R.string.moderation_log_empty))
                } else {
                    LogEntries(state.moderationLog)
                }
            null -> Unit
        }
    }
}

@Composable
private fun SectionItem(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Text(
        text = label,
        style = MaterialTheme.typography.titleMedium,
        color = if (selected) Palette.primary else Palette.fg,
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = 44.dp)
                .selectable(selected = selected, role = Role.Tab, onClick = onClick)
                .padding(horizontal = 8.dp, vertical = 10.dp),
    )
}

private const val WIDTH_FRACTION = 0.9f
private const val MAX_WIDTH = 880
private const val MAX_HEIGHT = 640
private const val LIST_WIDTH = 260

/** What the edit form holds before it is saved; it survives a rotation. */
internal class EditDraft(
    val name: String,
    val onName: (String) -> Unit,
    val description: String,
    val onDescription: (String) -> Unit,
    val audience: CommunityAudience,
    val onAudience: (CommunityAudience) -> Unit,
) {
    fun save(
        community: Community,
        actions: CommunityActions,
    ) = actions.updateCommunity(
        name.trim(),
        description.trim(),
        audience.takeIf { it != community.audience },
    )
}

@Composable
internal fun rememberEditDraft(community: Community): EditDraft {
    var name by rememberSaveable(community.communityId) { mutableStateOf(community.name) }
    var description by rememberSaveable(community.communityId) { mutableStateOf(community.description) }
    var audience by rememberSaveable(community.communityId) { mutableStateOf(community.audience) }
    return EditDraft(name, { name = it }, description, { description = it }, audience, { audience = it })
}

/** The fields of the edit form: the name, the description, the audience and the pictures. */
@Composable
internal fun EditFields(
    community: Community,
    busy: Boolean,
    actions: CommunityActions,
    draft: EditDraft,
) {
    val options =
        if (community.audience == CommunityAudience.OPEN) {
            listOf(
                CommunityAudience.OPEN to stringResource(R.string.community_open),
                CommunityAudience.PRIVATE to stringResource(R.string.community_private),
            )
        } else {
            listOf(CommunityAudience.PRIVATE to stringResource(R.string.community_private))
        }
    OutlinedTextField(draft.name, draft.onName, label = { Text(stringResource(R.string.community_name)) })
    OutlinedTextField(
        draft.description,
        draft.onDescription,
        label = { Text(stringResource(R.string.community_description)) },
        minLines = 3,
    )
    Choices(options, draft.audience, draft.onAudience)
    PictureRows(community, busy, actions)
}

@Composable
internal fun EditCommunityDialog(
    community: Community,
    busy: Boolean,
    actions: CommunityActions,
    onDismiss: () -> Unit,
) {
    val draft = rememberEditDraft(community)
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Palette.surface,
        textContentColor = Palette.fg,
        title = { Text(stringResource(R.string.community_edit)) },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) { EditFields(community, busy, actions, draft) }
        },
        confirmButton = {
            Button(
                onClick = {
                    draft.save(community, actions)
                    onDismiss()
                },
                enabled = !busy && draft.name.isNotBlank(),
            ) { Text(stringResource(R.string.save)) }
        },
        dismissButton = { CancelButton(onDismiss) },
    )
}

/** Each member with the button that makes them a moderator or takes it away; the owner's own to press. */
@Composable
internal fun MembersList(
    community: Community,
    members: List<CommunityMember>,
    busy: Boolean,
    actions: CommunityActions,
) {
    members.forEach { member ->
        CommunityMemberRow(member)
        if (member.role != CommunityRole.OWNER) {
            TextButton(
                onClick = {
                    actions.setCommunityRole(
                        member.accountId,
                        if (member.role == CommunityRole.MODERATOR) CommunityRole.MEMBER else CommunityRole.MODERATOR,
                    )
                },
                enabled = !busy && community.role == CommunityRole.OWNER,
            ) {
                Text(
                    stringResource(
                        if (member.role == CommunityRole.MODERATOR) {
                            R.string.community_remove_moderator
                        } else {
                            R.string.community_make_moderator
                        },
                    ),
                )
            }
        }
    }
}
