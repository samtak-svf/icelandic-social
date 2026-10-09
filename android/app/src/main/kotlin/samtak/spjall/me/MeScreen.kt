package samtak.spjall.me

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import samtak.spjall.brand.R
import samtak.spjall.feed.ComposePill
import samtak.spjall.feed.ComposerSheet
import samtak.spjall.feed.PostsActions
import samtak.spjall.feed.PostsViewModel
import samtak.spjall.feed.posts
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.SansFamily
import samtak.spjall.ui.SectionLabel
import samtak.spjall.ui.Type
import samtak.spjall.ui.VerifiedMark
import samtak.spjall.ui.capitals

/**
 * "Ég" (1e), on cream: the person and their invite link and QR code, then
 * their wall: a way to post and their own posts (decision 0034). The gear at
 * the top opens [SettingsScreen], which holds the rest.
 */
@Composable
fun MeScreen(
    state: MeViewModel.State,
    actions: MeActions,
    onSettings: () -> Unit,
    wall: PostsViewModel.State = PostsViewModel.State(),
    wallActions: PostsActions? = null,
    posted: Flow<Unit> = emptyFlow(),
) {
    var composing by rememberSaveable { mutableStateOf(false) }
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        LazyColumn(modifier = Modifier.safeDrawingPadding()) {
            item(key = "me") {
                Column(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    state.problem?.let { ProblemCard(it, actions::retry) }
                    state.me?.let { me ->
                        Row(verticalAlignment = Alignment.Top) {
                            Box(modifier = Modifier.weight(1f)) { Who(me.name, me.verified) }
                            IconButton(onClick = onSettings) {
                                Icon(
                                    AppIcons.Settings,
                                    contentDescription = stringResource(R.string.settings_title),
                                    tint = Palette.fg,
                                )
                            }
                        }
                        if (!me.verified) VerifyLink(actions::verify)
                        Label(R.string.invite_link_title)
                        InviteCard(state.link, state.busy, actions)
                    }
                    if (wallActions != null) {
                        ComposePill(
                            stringResource(R.string.wall_composer_placeholder),
                            onClick = { composing = true },
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    }
                }
            }
            wallActions?.let { wallPosts(wall, it) }
        }
    }
    if (composing && wallActions != null) {
        ComposerSheet(
            placeholder = stringResource(R.string.wall_composer_placeholder),
            busy = wall.posting,
            posted = posted,
            onPost = wallActions::post,
            onDismiss = { composing = false },
        )
    }
}

/** Ég's own posts, on white under the cream header, as they show in Fljótið. */
private fun LazyListScope.wallPosts(
    wall: PostsViewModel.State,
    actions: PostsActions,
) {
    item(key = "wall") { HorizontalDivider(color = Palette.border) }
    wall.problem?.let {
        item(key = "wall-problem") { Box(modifier = Modifier.padding(16.dp)) { ProblemCard(it, actions::refresh) } }
    }
    posts(wall, actions, empty = R.string.wall_empty)
}

/** The dark circle with the initials, the name in capitals, and whether Kenni vouched for it. */
@Composable
private fun Who(
    name: String?,
    verified: Boolean,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Avatar(name, kind = AvatarKind.Me, size = AVATAR.dp)
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                name?.let {
                    Text(
                        text = it.capitals(),
                        style = Type.accountName,
                        color = Palette.fg,
                        modifier = Modifier.weight(1f, fill = false).semantics { heading() },
                    )
                }
                if (verified) VerifiedMark(size = MARK.dp)
            }
            if (verified) SectionLabel(stringResource(R.string.verified_with_kennitala))
        }
    }
}

/** The way to the gold shield, for an account Kenni has not verified. */
@Composable
internal fun VerifyLink(onVerify: () -> Unit) {
    TextButton(onClick = onVerify) {
        VerifiedMark(size = MARK_LINK.dp)
        Text(
            text = stringResource(R.string.verify_cta),
            modifier = Modifier.padding(start = 8.dp),
            style = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 14.sp),
            color = Palette.fg,
        )
    }
}

@Composable
internal fun Label(text: Int) {
    SectionLabel(
        text = stringResource(text),
        modifier = Modifier.padding(start = 4.dp, top = 8.dp).semantics { heading() },
    )
}

/** A white rounded card on the cream. */
@Composable
internal fun Panel(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(Palette.surface, RoundedCornerShape(CARD_RADIUS.dp))
                .border(1.dp, Palette.border, RoundedCornerShape(CARD_RADIUS.dp)),
        content = content,
    )
}

/** The QR code beside the hint, then share and a new link side by side. The link itself stays out of sight. */
@Composable
private fun InviteCard(
    link: String?,
    busy: Boolean,
    actions: MeActions,
) {
    Panel {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                link?.let {
                    Box(
                        modifier =
                            Modifier
                                .size(QR.dp)
                                .border(1.dp, Palette.border, RoundedCornerShape(QR_RADIUS.dp))
                                .padding(6.dp),
                    ) {
                        QrCode(
                            text = it,
                            description = stringResource(R.string.invite_link_title),
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                }
                Text(
                    text = stringResource(R.string.invite_link_hint),
                    style = HINT,
                    color = Palette.fg,
                    modifier = Modifier.weight(1f),
                )
            }
            if (link == null) {
                Pill(stringResource(R.string.invite), filled = true, enabled = !busy, onClick = actions::newLink)
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Pill(
                        stringResource(R.string.share),
                        filled = true,
                        onClick = { actions.share(link) },
                        modifier = Modifier.weight(1f),
                    )
                    Pill(
                        stringResource(R.string.invite_link_rotate),
                        filled = false,
                        enabled = !busy,
                        onClick = actions::newLink,
                        modifier = Modifier.weight(ROTATE_WEIGHT),
                    )
                }
            }
        }
    }
}

@Composable
private fun Pill(
    text: String,
    filled: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val shape = RoundedCornerShape(PILL_RADIUS.dp)
    if (filled) {
        Button(onClick = onClick, enabled = enabled, shape = shape, modifier = modifier.heightIn(min = PILL.dp)) {
            Text(text, style = PILL_TEXT, maxLines = 1)
        }
    } else {
        OutlinedButton(
            onClick = onClick,
            enabled = enabled,
            shape = shape,
            colors = ButtonDefaults.outlinedButtonColors(containerColor = Palette.surface, contentColor = Palette.fg),
            modifier = modifier.heightIn(min = PILL.dp),
        ) { Text(text, style = PILL_TEXT, maxLines = 1) }
    }
}

@Composable
internal fun Confirm(
    text: String,
    confirm: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Palette.surface,
        textContentColor = Palette.fg,
        text = { Text(text) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

private const val AVATAR = 56
private const val MARK = 8
private const val MARK_LINK = 18
private const val CARD_RADIUS = 18
private const val QR = 104
private const val QR_RADIUS = 12
private const val PILL = 40
private const val PILL_RADIUS = 22
private const val ROTATE_WEIGHT = 1.4f

internal val ACTION = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 13.5.sp)
private val PILL_TEXT = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 12.5.sp)
internal val HINT =
    TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, lineHeight = 18.sp)
