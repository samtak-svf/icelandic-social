package samtak.spjall.social

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Author
import samtak.spjall.core.PersonProfile
import samtak.spjall.core.Relation
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.ReportTargetKind
import samtak.spjall.me.Confirm
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.NameWithMark
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.ScreenHeader
import samtak.spjall.ui.SectionLabel
import samtak.spjall.ui.calendarDate
import samtak.spjall.ui.wallCoverOf

/**
 * One account's wall as this one sees it (decisions 0114, 0115): the cover and who they are, how they stand to this
 * account and what to do, then the tabs. [tab] is the own wall as a tab, which has no way back and a gear.
 */
@Composable
fun PersonScreen(
    state: PersonViewModel.State,
    actions: PersonActions,
    tab: Boolean = false,
) {
    val profile = state.profile
    val own = profile?.relation == Relation.ONESELF
    LaunchedEffect(state.blocked) { if (state.blocked) actions.blocked() }
    // The wall post being reported; the dialog closes once the report is sent.
    var reportingPost by rememberSaveable { mutableStateOf<String?>(null) }
    if (reportingPost in state.reportedPosts) reportingPost = null
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(SUB_SCREEN_SIDES))) {
            val title = profile?.let { it.name ?: stringResource(R.string.person_unnamed) }.orEmpty()
            if (tab) ScreenHeader(title) else SubHeader(title, actions::back)
            SuspendedNotice()
            if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            LazyColumn(
                modifier = Modifier.weight(1f).testTag("person"),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem) { actions.retry() } } }
                if (state.reported) item(key = "reported") { Muted(stringResource(R.string.report_sent)) }
                profile?.let { item(key = "profile") { ProfileCard(it, state, !state.busy, actions) } }
                profile?.let { wallTabs(it, state, own, actions) { reportingPost = it } }
            }
        }
    }
    reportingPost?.let { postId ->
        ReportDialog(
            onSend = { reason, note ->
                reportingPost = null
                actions.report(ReportTarget(ReportTargetKind.POST, postId), reason, note)
            },
            onDismiss = { reportingPost = null },
        )
    }
}

@Composable
private fun ProfileCard(
    profile: PersonProfile,
    state: PersonViewModel.State,
    enabled: Boolean,
    actions: PersonActions,
) {
    val own = profile.relation == Relation.ONESELF
    SocialCard {
        CoverWithCamera(profile.accountId, state, own, actions)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            AvatarWithCamera(profile, own, actions)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                NameWithMark(
                    name = profile.name ?: stringResource(R.string.person_unnamed),
                    verified = profile.verified,
                    style = MaterialTheme.typography.titleMedium,
                    color = Palette.fg,
                )
                val friends = profile.friendCount
                Muted(pluralStringResource(R.plurals.person_friend_count, friends.toInt(), friends.toLong()))
                if (profile.relation != Relation.ONESELF && profile.relation != Relation.UNKNOWN) {
                    val mutual = profile.mutualCount
                    Muted(pluralStringResource(R.plurals.person_mutual_count, mutual.toInt(), mutual.toLong()))
                }
            }
            if (own) {
                IconButton(onClick = actions::settings, modifier = Modifier.testTag("gear")) {
                    Icon(Icons.Filled.Settings, stringResource(R.string.settings_title))
                }
            } else if (profile.relation != Relation.UNKNOWN) {
                PersonMenu(profile, actions)
            }
        }
        state.wall?.bio?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        state.wall?.let { Muted(stringResource(R.string.wall_joined, monthName(it.joinedMonth))) }
        RelationPart(profile, enabled, actions)
        SnoozePart(profile, enabled, actions)
    }
}

@Composable
private fun CoverWithCamera(
    accountId: String,
    state: PersonViewModel.State,
    own: Boolean,
    actions: PersonActions,
) {
    Box {
        CoverBand(wallCoverOf(accountId, state.wall?.cover), stringResource(R.string.wall_cover_alt))
        // The web's camera on the cover; a suspended account may only take the cover off, in About.
        if (own && !suspended()) {
            IconButton(
                onClick = actions::chooseCover,
                modifier = Modifier.align(Alignment.TopEnd).testTag("cover-camera"),
            ) {
                Icon(AppIcons.Camera, stringResource(R.string.community_cover_choose), tint = Palette.fg)
            }
        }
    }
}

/** The one action each relation has; none for this account itself or one the core cannot place. */
@Composable
private fun RelationPart(
    profile: PersonProfile,
    enabled: Boolean,
    actions: PersonActions,
) {
    when (profile.relation) {
        Relation.NONE ->
            Button(
                onClick = actions::add,
                enabled = enabled,
                modifier = Modifier.heightIn(min = 44.dp).testTag("add"),
            ) { Text(stringResource(R.string.person_add_friend)) }
        Relation.SENT -> {
            Muted(stringResource(R.string.person_request_sent))
            Choice(R.string.person_cancel_request, enabled, actions::cancel)
        }
        Relation.INCOMING -> {
            Muted(stringResource(R.string.person_answer_request))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = actions::accept, enabled = enabled, modifier = Modifier.heightIn(min = 44.dp)) {
                    Text(stringResource(R.string.person_accept))
                }
                OutlinedButton(
                    onClick = actions::decline,
                    enabled = enabled,
                    modifier = Modifier.heightIn(min = 44.dp),
                ) { Text(stringResource(R.string.person_decline)) }
            }
        }
        Relation.FRIENDS -> FriendsPart(profile, enabled, actions)
        Relation.ONESELF, Relation.UNKNOWN -> Unit
    }
}

@Composable
private fun FriendsPart(
    profile: PersonProfile,
    enabled: Boolean,
    actions: PersonActions,
) {
    var confirming by rememberSaveable { mutableStateOf(false) }
    Text(stringResource(R.string.person_friends), style = MaterialTheme.typography.titleSmall)
    profile.friendsSince?.let { Muted(stringResource(R.string.person_friends_since, calendarDate(it))) }
    OutlinedButton(
        onClick = { confirming = true },
        enabled = enabled,
        colors = ButtonDefaults.outlinedButtonColors(contentColor = Palette.danger),
        modifier = Modifier.heightIn(min = 44.dp).testTag("end"),
    ) { Text(stringResource(R.string.friend_end)) }
    if (confirming) {
        Confirm(
            text = stringResource(R.string.friend_end_confirm, profile.name ?: stringResource(R.string.person_unnamed)),
            confirm = stringResource(R.string.friend_end),
            onConfirm = {
                confirming = false
                actions.end()
            },
            onDismiss = { confirming = false },
        )
    }
}

/** Snoozing hides the account's posts from the home feed; there is nothing to hide of this account's own. */
@Composable
private fun SnoozePart(
    profile: PersonProfile,
    enabled: Boolean,
    actions: PersonActions,
) {
    if (profile.relation == Relation.ONESELF || profile.relation == Relation.UNKNOWN) return
    val until = profile.snoozedUntil
    if (until == null) {
        Choice(R.string.person_snooze, enabled, actions::snooze)
    } else {
        Muted(stringResource(R.string.person_snoozed_until, calendarDate(until)))
        Choice(R.string.person_unsnooze, enabled, actions::unsnooze)
    }
}

@Composable
private fun Choice(
    label: Int,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    OutlinedButton(onClick = onClick, enabled = enabled, modifier = Modifier.heightIn(min = 44.dp)) {
        Text(stringResource(label))
    }
}

@Composable
internal fun Mutual(
    profile: PersonProfile,
    actions: PersonActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        SectionLabel(stringResource(R.string.person_mutual_heading))
        profile.mutualFriends.forEach { friend: Author ->
            PersonRow(friend, null, onOpen = { actions.open(friend.accountId) })
        }
    }
}

@Composable
internal fun Shared(
    profile: PersonProfile,
    actions: PersonActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        SectionLabel(stringResource(R.string.person_shared_communities))
        profile.sharedCommunities.forEach { community ->
            Text(
                text = community.name,
                style = MaterialTheme.typography.bodyLarge,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .clickable(role = Role.Button) { actions.openCommunity(community.communityId) },
            )
        }
    }
}
