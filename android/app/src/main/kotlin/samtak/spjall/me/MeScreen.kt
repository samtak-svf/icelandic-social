package samtak.spjall.me

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import samtak.spjall.brand.R
import samtak.spjall.core.AccountDevice
import samtak.spjall.core.Platform
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.SansFamily
import samtak.spjall.ui.SectionLabel
import samtak.spjall.ui.Type
import samtak.spjall.ui.VerifiedMark
import samtak.spjall.ui.calendarDate
import samtak.spjall.ui.capitals

/**
 * "Ég" (1e), on cream: the person, their invite link and QR code, the
 * read-marker and typing toggles, who they blocked, their devices, and
 * deleting the account. While the system blocks the app's notifications, a
 * notice under the devices says so.
 */
@Composable
fun MeScreen(
    state: MeViewModel.State,
    actions: MeActions,
    notificationsOff: Boolean = false,
) {
    var revoking by rememberSaveable { mutableStateOf<String?>(null) }
    var deleting by rememberSaveable { mutableStateOf(false) }
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
                Who(me.name, me.verified)
                Label(R.string.invite_link_title)
                InviteCard(state.link, state.busy, actions)
                Label(R.string.devices_title)
                Devices(me.devices, enabled = !state.busy) { revoking = it }
                if (notificationsOff) NotificationsOff(actions::notificationSettings)
                // The design leaves these out; decision 0009 keeps them, in the same cards.
                state.settings?.let { Panel { PrivacySection(it, !state.busy, actions) } }
                Label(R.string.blocked_title)
                Panel { BlockedSection(state.blocked, !state.busy, actions::unblock) }
                TextButton(
                    onClick = { deleting = true },
                    enabled = !state.busy,
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                ) {
                    Text(text = stringResource(R.string.delete_account), style = ACTION, color = Palette.danger)
                }
            }
        }
    }
    revoking?.let { deviceId ->
        Confirm(
            text = stringResource(R.string.device_revoke_confirm),
            confirm = stringResource(R.string.device_revoke),
            onConfirm = {
                revoking = null
                actions.revoke(deviceId)
            },
            onDismiss = { revoking = null },
        )
    }
    if (deleting) {
        Confirm(
            text = stringResource(R.string.delete_account_confirm),
            confirm = stringResource(R.string.delete_account),
            onConfirm = {
                deleting = false
                actions.deleteAccount()
            },
            onDismiss = { deleting = false },
        )
    }
}

/** Every device signed in to the account, one card. */
@Composable
private fun Devices(
    devices: List<AccountDevice>,
    enabled: Boolean,
    onRevoke: (String) -> Unit,
) {
    Panel {
        devices.forEachIndexed { i, device ->
            if (i > 0) HorizontalDivider(color = Palette.border)
            DeviceRow(device, enabled = enabled, onRevoke = { onRevoke(device.deviceId) })
        }
    }
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

@Composable
private fun Label(text: Int) {
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

@Composable
private fun NotificationsOff(onSettings: () -> Unit) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(Palette.secondarySubtle, RoundedCornerShape(NOTICE_RADIUS.dp))
                .padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(AppIcons.BellOff, contentDescription = null, tint = Palette.fg, modifier = Modifier.size(ICON.dp))
        Column {
            Text(text = stringResource(R.string.notifications_off), style = HINT)
            TextButton(
                onClick = onSettings,
                contentPadding = ButtonDefaults.TextButtonWithIconContentPadding,
                modifier = Modifier.padding(start = 0.dp),
            ) {
                Text(stringResource(R.string.notifications_settings), style = ACTION, color = Palette.primary)
            }
        }
    }
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
private fun DeviceRow(
    device: AccountDevice,
    enabled: Boolean,
    onRevoke: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 14.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier.size(WELL.dp).background(Palette.muted, RoundedCornerShape(WELL_RADIUS.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(AppIcons.Phone, contentDescription = null, tint = Palette.fg, modifier = Modifier.size(ICON_SMALL.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text =
                    when (device.platform) {
                        Platform.ANDROID -> "Android"
                        Platform.IOS -> "iPhone"
                    },
                style = NAME,
                color = Palette.fg,
                maxLines = 1,
            )
            Text(
                text = stringResource(R.string.device_added, calendarDate(device.createdAt)),
                style = MaterialTheme.typography.bodySmall,
                color = Palette.mutedFg,
            )
        }
        if (device.current) {
            Text(
                text = stringResource(R.string.device_this).capitals(),
                style = THIS_DEVICE,
                color = Palette.fg,
                modifier =
                    Modifier
                        .background(Palette.secondarySubtle, RoundedCornerShape(PILL_RADIUS.dp))
                        .padding(horizontal = 8.dp, vertical = 4.dp),
            )
        }
        // The current device too: revoking it is how this phone signs out.
        TextButton(onClick = onRevoke, enabled = enabled, contentPadding = PaddingValues(horizontal = 10.dp)) {
            Text(stringResource(R.string.device_revoke), style = REVOKE, color = Palette.primary)
        }
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
private const val CARD_RADIUS = 18
private const val NOTICE_RADIUS = 14
private const val QR = 104
private const val QR_RADIUS = 12
private const val PILL = 40
private const val PILL_RADIUS = 22
private const val ROTATE_WEIGHT = 1.4f
private const val WELL = 30
private const val WELL_RADIUS = 8
private const val ICON = 18
private const val ICON_SMALL = 16

private val NAME = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 14.5.sp)
private val ACTION = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 13.5.sp)
private val PILL_TEXT = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 12.5.sp)
private val REVOKE = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 12.sp)
private val HINT =
    TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, lineHeight = 18.sp)
private val THIS_DEVICE =
    TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 9.5.sp, letterSpacing = 0.1.em)
