package samtak.spjall.me

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import samtak.spjall.BuildConfig
import samtak.spjall.brand.R
import samtak.spjall.core.AccountDevice
import samtak.spjall.core.Platform
import samtak.spjall.core.coreVersion
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.NotificationsOff
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.SansFamily
import samtak.spjall.ui.Type
import samtak.spjall.ui.calendarDate
import samtak.spjall.ui.capitals

/**
 * The settings behind Ég's gear (decision 0034): the account's devices, the
 * read-marker and typing toggles, who the person blocked, and deleting the
 * account. While the system blocks the app's notifications, a notice under the
 * devices says so.
 */
@Composable
fun SettingsScreen(
    state: MeViewModel.State,
    actions: MeActions,
    onBack: () -> Unit,
    notificationsOff: Boolean = false,
) {
    var revoking by rememberSaveable { mutableStateOf<String?>(null) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column {
            Header(onBack)
            Column(
                modifier =
                    Modifier
                        .windowInsetsPadding(
                            WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom),
                        ).verticalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                state.problem?.let { ProblemCard(it, actions::retry) }
                state.me?.let { me ->
                    if (!me.verified) VerifyLink(actions::verify)
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
                VersionLine(Modifier.align(Alignment.CenterHorizontally))
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

/** The app's and the core's version, for a bug report. */
@Composable
private fun VersionLine(modifier: Modifier) {
    Text(
        text =
            stringResource(
                R.string.app_version,
                BuildConfig.VERSION_NAME,
                "${BuildConfig.VERSION_CODE}",
                coreVersion(),
            ),
        style = MaterialTheme.typography.bodySmall,
        color = Palette.mutedFg,
        modifier = modifier,
    )
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

private const val PILL_RADIUS = 22
private const val WELL = 30
private const val WELL_RADIUS = 8
private const val ICON_SMALL = 16

private val NAME = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 14.5.sp)
private val REVOKE = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 12.sp)
private val THIS_DEVICE =
    TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 9.5.sp, letterSpacing = 0.1.em)

/** The back arrow and the screen's title, on the safe area's top edge. */
@Composable
private fun Header(onBack: () -> Unit) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
                .padding(start = 4.dp, end = 16.dp, top = 2.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        IconButton(onClick = onBack) {
            Icon(AppIcons.Back, contentDescription = stringResource(R.string.back), tint = Palette.fg)
        }
        Text(
            text = stringResource(R.string.settings_title).capitals(),
            style = Type.screenTitle,
            color = Palette.fg,
            modifier = Modifier.semantics { heading() },
        )
    }
}
