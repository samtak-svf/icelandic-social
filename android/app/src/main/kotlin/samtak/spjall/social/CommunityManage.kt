package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.layout.AnimatedPane
import androidx.compose.material3.adaptive.layout.ListDetailPaneScaffoldRole
import androidx.compose.material3.adaptive.layout.ThreePaneScaffoldDestinationItem
import androidx.compose.material3.adaptive.navigation.NavigableListDetailPaneScaffold
import androidx.compose.material3.adaptive.navigation.rememberListDetailPaneScaffoldNavigator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import samtak.spjall.brand.R
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityMember
import samtak.spjall.core.CommunityRole
import samtak.spjall.ui.CancelButton
import samtak.spjall.ui.Palette

/** The five parts of Stjórna, in the order of decision 0087. */
internal enum class ManagePart { EDIT, REQUESTS, REPORTS, MEMBERS, LOG }

/** The test tags of the two panes. */
internal const val MANAGE_SECTIONS = "manage-sections"
internal const val MANAGE_DETAIL = "manage-detail"

/**
 * The two parts that have a screen and a view model of their own, drawn in the detail pane. The navigation graph
 * supplies them (their view models are keyed to the community, so the pane and the screen share one).
 */
internal class ManageSlots(
    val requests: @Composable () -> Unit = {},
    val reports: @Composable () -> Unit = {},
)

/**
 * Stjórna on an expanded window (decision 0087): a list-detail layout whose list keeps its place with the counts
 * on its items, and whose detail pane draws the part chosen. [onDelete] asks to delete the community, [onBack]
 * leaves Stjórna for the community.
 */
@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
internal fun ManagePage(
    community: Community,
    state: CommunityViewModel.State,
    actions: CommunityActions,
    slots: ManageSlots,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val owner = community.role == CommunityRole.OWNER
    val parts =
        buildList {
            if (owner) add(ManagePart.EDIT)
            if (community.moderates) {
                add(ManagePart.REQUESTS)
                add(ManagePart.REPORTS)
            }
            if (owner) add(ManagePart.MEMBERS)
            if (community.moderates) add(ManagePart.LOG)
        }
    val navigator =
        rememberListDetailPaneScaffoldNavigator<ManagePart>(
            initialDestinationHistory =
                listOfNotNull(parts.firstOrNull()).map {
                    ThreePaneScaffoldDestinationItem(ListDetailPaneScaffoldRole.Detail, it)
                },
        )
    val scope = rememberCoroutineScope()
    val chosen = navigator.currentDestination?.contentKey
    LaunchedEffect(chosen) {
        when (chosen) {
            ManagePart.MEMBERS -> actions.loadMembers()
            ManagePart.LOG -> actions.loadModerationLog()
            else -> Unit
        }
    }
    NavigableListDetailPaneScaffold(
        navigator = navigator,
        modifier = modifier,
        listPane = {
            AnimatedPane {
                SectionList(community, parts, state.busy, chosen, onDelete) { part ->
                    scope.launch { navigator.navigateTo(ListDetailPaneScaffoldRole.Detail, part) }
                }
            }
        },
        detailPane = {
            AnimatedPane { SectionDetail(chosen, community, state, actions, slots) }
        },
    )
}

/** The list pane: the parts with their counts, the one chosen marked, and deleting the community at the foot. */
@Composable
private fun SectionList(
    community: Community,
    parts: List<ManagePart>,
    busy: Boolean,
    chosen: ManagePart?,
    onDelete: () -> Unit,
    onChoose: (ManagePart) -> Unit,
) {
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
        parts.forEach { part ->
            val label =
                when (part) {
                    ManagePart.EDIT -> stringResource(R.string.community_edit)
                    ManagePart.REQUESTS ->
                        if (waiting > 0) {
                            pluralStringResource(R.plurals.join_requests_waiting, waiting, waiting)
                        } else {
                            stringResource(R.string.join_requests_title)
                        }
                    ManagePart.REPORTS ->
                        if (reports > 0) {
                            "${stringResource(R.string.moderation_queue)} ($reports)"
                        } else {
                            stringResource(R.string.moderation_queue)
                        }
                    ManagePart.MEMBERS -> stringResource(R.string.community_members_title)
                    ManagePart.LOG -> stringResource(R.string.moderation_log_title)
                }
            SectionItem(label, part == chosen) { onChoose(part) }
        }
        if (community.role == CommunityRole.OWNER) {
            OutlinedButton(
                onClick = onDelete,
                enabled = !busy,
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Palette.danger),
                modifier = Modifier.padding(top = 12.dp).heightIn(min = 44.dp),
            ) { Text(stringResource(R.string.community_delete)) }
        }
    }
}

/** The detail pane: the part chosen, the list beside it kept in place. */
@Composable
private fun SectionDetail(
    chosen: ManagePart?,
    community: Community,
    state: CommunityViewModel.State,
    actions: CommunityActions,
    slots: ManageSlots,
) {
    // The two parts with a view model of their own bring their own scrolling list.
    when (chosen) {
        ManagePart.REQUESTS -> Box(Modifier.fillMaxSize().testTag(MANAGE_DETAIL)) { slots.requests() }
        ManagePart.REPORTS -> Box(Modifier.fillMaxSize().testTag(MANAGE_DETAIL)) { slots.reports() }
        else ->
            Column(
                modifier =
                    Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp)
                        .testTag(MANAGE_DETAIL),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                when (chosen) {
                    ManagePart.EDIT -> {
                        val draft = rememberEditDraft(community)
                        EditFields(community, state.busy, actions, draft)
                        Button(
                            onClick = { draft.save(community, actions) },
                            enabled = !state.busy && draft.name.isNotBlank(),
                        ) { Text(stringResource(R.string.save)) }
                    }
                    ManagePart.MEMBERS -> MembersList(community, state.members, state.busy, actions)
                    ManagePart.LOG ->
                        if (state.moderationLog.isEmpty()) {
                            Muted(stringResource(R.string.moderation_log_empty))
                        } else {
                            LogEntries(state.moderationLog)
                        }
                    else -> Unit
                }
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
