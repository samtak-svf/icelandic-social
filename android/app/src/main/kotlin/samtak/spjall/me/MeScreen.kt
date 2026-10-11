package samtak.spjall.me

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import samtak.spjall.brand.R
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.NameWithMark
import samtak.spjall.ui.Palette
import samtak.spjall.ui.PhotoOf
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.SansFamily
import samtak.spjall.ui.SectionLabel
import samtak.spjall.ui.Type
import samtak.spjall.ui.VerifiedMark
import samtak.spjall.ui.capitals

/**
 * "Ég" (1e), on cream: the person, their photo, their invite link and QR
 * code, then the settings (decision 0044). [version] is the line at the
 * foot, for a bug report.
 */
@Composable
fun MeScreen(
    state: MeViewModel.State,
    actions: MeActions,
    notificationsOff: Boolean = false,
    version: String? = null,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(
            modifier =
                Modifier
                    .safeDrawingPadding()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            state.problem?.let { ProblemCard(it, actions::retry) }
            state.me?.let { me ->
                Who(
                    me.name,
                    me.verified,
                    me.photo?.let { PhotoOf(me.accountId, it) },
                    onPhoto = actions::choosePhoto,
                    enabled = !state.busy,
                )
                PhotoControls(me.photo != null, state.busy, actions)
                if (!me.verified) VerifyLink(actions::verify)
                Label(R.string.invite_link_title)
                InviteCard(state.link, state.busy, actions)
                Settings(me, state, actions, notificationsOff)
            }
            version?.let { VersionLine(it, Modifier.align(Alignment.CenterHorizontally)) }
        }
    }
}

/**
 * The photo, or the dark circle with the initials; the name in capitals, and whether Kenni vouched for it.
 * A tap on the photo opens the picker, as its buttons below do (decision 0043).
 */
@Composable
private fun Who(
    name: String?,
    verified: Boolean,
    photo: PhotoOf?,
    onPhoto: () -> Unit,
    enabled: Boolean,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        val label = stringResource(if (photo != null) R.string.photo_change else R.string.photo_choose)
        Avatar(
            name,
            kind = AvatarKind.Me,
            size = AVATAR.dp,
            photo = photo,
            modifier =
                Modifier
                    .clip(CircleShape)
                    .clickable(enabled = enabled, role = Role.Button, onClick = onPhoto)
                    .semantics { contentDescription = label },
        )
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            name?.let {
                NameWithMark(
                    it.capitals(),
                    verified,
                    style = Type.accountName,
                    color = Palette.fg,
                    markSize = MARK.dp,
                    modifier = Modifier.semantics { heading() },
                )
            }
            if (verified) SectionLabel(stringResource(R.string.verified_with_kennitala))
        }
    }
}

/**
 * Set, replace or remove the photo (decision 0039), and the one line that says who sees it: everyone signed in,
 * since it is not end-to-end encrypted. Removing asks first.
 */
@Composable
private fun PhotoControls(
    hasPhoto: Boolean,
    busy: Boolean,
    actions: MeActions,
) {
    var removing by rememberSaveable { mutableStateOf(false) }
    Column {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(onClick = actions::choosePhoto, enabled = !busy) {
                Text(
                    text = stringResource(if (hasPhoto) R.string.photo_change else R.string.photo_choose),
                    style = ACTION,
                    color = Palette.fg,
                )
            }
            if (hasPhoto) {
                TextButton(onClick = { removing = true }, enabled = !busy) {
                    Text(text = stringResource(R.string.photo_remove), style = ACTION, color = Palette.fg)
                }
            }
        }
        Text(
            text = stringResource(R.string.photo_seen_by_all),
            style = HINT,
            color = Palette.fg,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
    }
    if (removing) {
        Confirm(
            text = stringResource(R.string.photo_remove_confirm),
            confirm = stringResource(R.string.photo_remove),
            onConfirm = {
                removing = false
                actions.removePhoto()
            },
            onDismiss = { removing = false },
        )
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

private const val AVATAR = 72
private const val MARK = 22
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
