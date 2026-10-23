package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityMember
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.ModerationLogAction
import samtak.spjall.core.ModerationLogEntry
import samtak.spjall.me.Confirm
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.CancelButton
import samtak.spjall.ui.Palette
import samtak.spjall.ui.SectionLabel
import samtak.spjall.ui.VerifiedMark
import samtak.spjall.ui.calendarDate

/** The dialog open over the community screen: one at a time, each opened from the one before or from the header. */
internal enum class CommunityDialog { MANAGE, INFO, EDIT, MEMBERS, LOG, DELETE }

/** Whichever community dialog is open, and the calls that open the next one or close it. */
@Composable
internal fun CommunityDialogs(
    state: CommunityViewModel.State,
    actions: CommunityActions,
    dialog: CommunityDialog?,
    onDialog: (CommunityDialog?) -> Unit,
) {
    val community = state.community ?: return
    when (dialog) {
        CommunityDialog.MANAGE ->
            ManageDialog(
                community = community,
                busy = state.busy,
                actions = actions,
                onEdit = { onDialog(CommunityDialog.EDIT) },
                onMembers = {
                    onDialog(CommunityDialog.MEMBERS)
                    actions.loadMembers()
                },
                onLog = {
                    onDialog(CommunityDialog.LOG)
                    actions.loadModerationLog()
                },
                onDelete = { onDialog(CommunityDialog.DELETE) },
                onDismiss = { onDialog(null) },
            )
        CommunityDialog.INFO -> AboutCommunityDialog(community, state.members) { onDialog(null) }
        CommunityDialog.EDIT -> EditCommunityDialog(community, state.busy, actions) { onDialog(null) }
        CommunityDialog.MEMBERS ->
            CommunityMembersDialog(community, state.members, state.busy, actions) { onDialog(null) }
        CommunityDialog.LOG -> ModerationLogDialog(state.moderationLog) { onDialog(null) }
        CommunityDialog.DELETE ->
            DeleteCommunityConfirm(
                name = community.name,
                onConfirm = {
                    onDialog(null)
                    actions.deleteCommunity()
                },
                onDismiss = { onDialog(null) },
            )
        null -> Unit
    }
}

/** The owner's tools in the manage dialog: the edit, the members, and deleting the community at the bottom. */
@Composable
private fun OwnerTools(
    busy: Boolean,
    onEdit: () -> Unit,
    onMembers: () -> Unit,
    onDelete: () -> Unit,
) {
    TextButton(onClick = onEdit, enabled = !busy) {
        Text(stringResource(R.string.community_edit))
    }
    TextButton(onClick = onMembers, enabled = !busy) {
        Text(stringResource(R.string.community_members_title))
    }
    OutlinedButton(
        onClick = onDelete,
        enabled = !busy,
        colors = ButtonDefaults.outlinedButtonColors(contentColor = Palette.danger),
        modifier = Modifier.heightIn(min = 44.dp),
    ) { Text(stringResource(R.string.community_delete)) }
}

/**
 * The tools a moderator and the owner share, behind the one "Stjórna" button: the report queue and the waiting
 * join requests; the owner also deletes the community here, at the bottom, where it reads as the danger it is.
 */
@Composable
private fun ManageDialog(
    community: Community,
    busy: Boolean,
    actions: CommunityActions,
    onEdit: () -> Unit,
    onMembers: () -> Unit,
    onLog: () -> Unit,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    val waiting = community.pendingJoinRequests?.toInt() ?: 0
    val reports = community.openReports?.toInt() ?: 0
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Palette.surface,
        textContentColor = Palette.fg,
        title = { Text(stringResource(R.string.community_manage)) },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TextButton(
                    onClick = {
                        onDismiss()
                        actions.reports()
                    },
                ) {
                    Text(
                        if (reports > 0) {
                            "${stringResource(R.string.moderation_queue)} ($reports)"
                        } else {
                            stringResource(R.string.moderation_queue)
                        },
                    )
                }
                TextButton(
                    onClick = {
                        onDismiss()
                        actions.requests()
                    },
                ) {
                    Text(
                        if (waiting > 0) {
                            pluralStringResource(R.plurals.join_requests_waiting, waiting, waiting)
                        } else {
                            stringResource(R.string.join_requests_title)
                        },
                    )
                }
                if (community.role == CommunityRole.OWNER) OwnerTools(busy, onEdit, onMembers, onDelete)
                if (community.moderates) {
                    TextButton(onClick = onLog, enabled = !busy) {
                        Text(stringResource(R.string.moderation_log_title))
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { CancelButton(onDismiss) },
    )
}

@Composable
private fun AboutCommunityDialog(
    community: Community,
    members: List<CommunityMember>,
    onDismiss: () -> Unit,
) {
    val audience =
        stringResource(
            if (community.audience == CommunityAudience.OPEN) R.string.community_open else R.string.community_private,
        )
    val memberCount = community.memberCount?.toInt() ?: members.size
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Palette.surface,
        textContentColor = Palette.fg,
        title = { Text(stringResource(R.string.community_info)) },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(community.description, style = MaterialTheme.typography.bodyLarge)
                Text(
                    "$audience · ${pluralStringResource(R.plurals.community_members, memberCount, memberCount)}",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Muted(stringResource(R.string.community_not_encrypted_notice))
                SectionLabel(stringResource(R.string.community_members_title))
                members.forEach { CommunityMemberRow(it) }
            }
        },
        confirmButton = {},
        dismissButton = { CancelButton(onDismiss) },
    )
}

@Composable
private fun EditCommunityDialog(
    community: Community,
    busy: Boolean,
    actions: CommunityActions,
    onDismiss: () -> Unit,
) {
    var name by rememberSaveable(community.communityId) { mutableStateOf(community.name) }
    var description by rememberSaveable(community.communityId) { mutableStateOf(community.description) }
    var audience by rememberSaveable(community.communityId) { mutableStateOf(community.audience) }
    val options =
        if (community.audience == CommunityAudience.OPEN) {
            listOf(
                CommunityAudience.OPEN to stringResource(R.string.community_open),
                CommunityAudience.PRIVATE to stringResource(R.string.community_private),
            )
        } else {
            listOf(CommunityAudience.PRIVATE to stringResource(R.string.community_private))
        }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Palette.surface,
        textContentColor = Palette.fg,
        title = { Text(stringResource(R.string.community_edit)) },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(name, { name = it }, label = { Text(stringResource(R.string.community_name)) })
                OutlinedTextField(
                    description,
                    { description = it },
                    label = { Text(stringResource(R.string.community_description)) },
                    minLines = 3,
                )
                Choices(options, audience) { audience = it }
                PictureRows(community, busy, actions)
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    actions.updateCommunity(
                        name.trim(),
                        description.trim(),
                        audience.takeIf { it != community.audience },
                    )
                    onDismiss()
                },
                enabled = !busy && name.isNotBlank(),
            ) { Text(stringResource(R.string.save)) }
        },
        dismissButton = { CancelButton(onDismiss) },
    )
}

@Composable
private fun CommunityMembersDialog(
    community: Community,
    members: List<CommunityMember>,
    busy: Boolean,
    actions: CommunityActions,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Palette.surface,
        textContentColor = Palette.fg,
        title = { Text(stringResource(R.string.community_members_title)) },
        text = {
            Column(
                modifier = Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                members.forEach { member ->
                    CommunityMemberRow(member)
                    if (member.role != CommunityRole.OWNER) {
                        TextButton(
                            onClick = {
                                actions.setCommunityRole(
                                    member.accountId,
                                    if (member.role == CommunityRole.MODERATOR) {
                                        CommunityRole.MEMBER
                                    } else {
                                        CommunityRole.MODERATOR
                                    },
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
        },
        confirmButton = {},
        dismissButton = { CancelButton(onDismiss) },
    )
}

@Composable
private fun CommunityMemberRow(member: CommunityMember) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Avatar(member, size = 36.dp)
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(member.name ?: stringResource(R.string.person_unnamed))
                if (member.verified) VerifiedMark()
            }
            Text(
                stringResource(
                    when (member.role) {
                        CommunityRole.OWNER -> R.string.community_role_owner
                        CommunityRole.MODERATOR -> R.string.community_role_moderator
                        CommunityRole.MEMBER -> R.string.community_role_member
                    },
                ),
                style = MaterialTheme.typography.bodySmall,
                color = Palette.mutedFg,
            )
        }
    }
}

@Composable
private fun ModerationLogDialog(
    entries: List<ModerationLogEntry>,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Palette.surface,
        textContentColor = Palette.fg,
        title = { Text(stringResource(R.string.moderation_log_title)) },
        text = {
            if (entries.isEmpty()) {
                Muted(stringResource(R.string.moderation_log_empty))
            } else {
                Column(
                    modifier = Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    entries.forEach { entry ->
                        Text(
                            "${entry.actor.shownName()} · ${stringResource(entry.action.label())} · " +
                                calendarDate(entry.createdAt),
                            style = MaterialTheme.typography.titleSmall,
                        )
                        entry.targetAccount?.let { Text(it.shownName(), style = MaterialTheme.typography.bodyMedium) }
                        if (entry.reason.isNotBlank()) Text(entry.reason, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { CancelButton(onDismiss) },
    )
}

/** What a log entry records; an action a later server adds reads as done. */
private val logLabels =
    mapOf(
        ModerationLogAction.HIDE_POST to R.string.moderation_hide,
        ModerationLogAction.HIDE_COMMENT to R.string.moderation_hide,
        ModerationLogAction.REMOVE_POST to R.string.moderation_remove,
        ModerationLogAction.REMOVE_COMMENT to R.string.moderation_remove,
        ModerationLogAction.REMOVE_MEMBER to R.string.moderation_remove,
        ModerationLogAction.RESTORE_POST to R.string.moderation_restore,
        ModerationLogAction.RESTORE_COMMENT to R.string.moderation_restore,
        ModerationLogAction.RESTORE_COMMUNITY to R.string.moderation_restore,
        ModerationLogAction.MUTE_MEMBER to R.string.moderation_mute,
        ModerationLogAction.UNMUTE_MEMBER to R.string.moderation_unmute,
        ModerationLogAction.BAN_MEMBER to R.string.moderation_ban,
        ModerationLogAction.UNBAN_MEMBER to R.string.moderation_unban,
        ModerationLogAction.DELETE_COMMUNITY to R.string.community_delete,
        ModerationLogAction.SET_COMMUNITY_PICTURE to R.string.moderation_log_community_picture_set,
        ModerationLogAction.REMOVE_COMMUNITY_PICTURE to R.string.moderation_log_community_picture_removed,
        ModerationLogAction.SET_COMMUNITY_COVER to R.string.moderation_log_community_cover_set,
        ModerationLogAction.REMOVE_COMMUNITY_COVER to R.string.moderation_log_community_cover_removed,
        ModerationLogAction.PIN_POST to R.string.moderation_log_post_pinned,
        ModerationLogAction.UNPIN_POST to R.string.moderation_log_post_unpinned,
    )

private fun ModerationLogAction.label(): Int = logLabels[this] ?: R.string.moderation_done

@Composable
private fun DeleteCommunityConfirm(
    name: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    Confirm(
        text = stringResource(R.string.community_delete_confirm, name),
        confirm = stringResource(R.string.community_delete),
        onConfirm = onConfirm,
        onDismiss = onDismiss,
    )
}
