package samtak.spjall.me

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.AccountDevice
import samtak.spjall.core.Platform
import samtak.spjall.ui.ProblemCard
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * "Ég": the person, their invite link and QR code, the read-marker and typing
 * toggles, who they blocked, their devices, and deleting the account.
 */
@Composable
fun MeScreen(
    state: MeViewModel.State,
    actions: MeActions,
) {
    var revoking by rememberSaveable { mutableStateOf<String?>(null) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(text = stringResource(R.string.tab_me), style = MaterialTheme.typography.displaySmall)
            if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            state.problem?.let { ProblemCard(it, actions::retry) }
            state.me?.let { me ->
                me.name?.let { Text(text = it, style = MaterialTheme.typography.headlineSmall) }
                if (me.verified) {
                    Text(
                        text = stringResource(R.string.verified_with_kennitala),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                HorizontalDivider()
                InviteSection(state.link, state.busy, actions)
                HorizontalDivider()
                state.settings?.let { PrivacySection(it, !state.busy, actions) }
                BlockedSection(state.blocked, !state.busy, actions::unblock)
                HorizontalDivider()
                Text(text = stringResource(R.string.devices_title), style = MaterialTheme.typography.titleMedium)
                me.devices.forEach { device ->
                    DeviceRow(device, enabled = !state.busy, onRevoke = { revoking = device.deviceId })
                }
                HorizontalDivider()
                OutlinedButton(onClick = { deleting = true }, enabled = !state.busy) {
                    Text(text = stringResource(R.string.delete_account), color = MaterialTheme.colorScheme.error)
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

@Composable
private fun ColumnScope.InviteSection(
    link: String?,
    busy: Boolean,
    actions: MeActions,
) {
    Text(text = stringResource(R.string.invite_link_title), style = MaterialTheme.typography.titleMedium)
    Text(text = stringResource(R.string.invite_link_hint), style = MaterialTheme.typography.bodyMedium)
    if (link == null) {
        Button(onClick = actions::newLink, enabled = !busy) { Text(stringResource(R.string.invite)) }
        return
    }
    QrCode(
        text = link,
        description = stringResource(R.string.invite_link_title),
        modifier = Modifier.fillMaxWidth(QR_WIDTH).align(Alignment.CenterHorizontally),
    )
    Text(text = link, style = MaterialTheme.typography.bodySmall)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = { actions.share(link) }) { Text(stringResource(R.string.share)) }
        OutlinedButton(onClick = actions::newLink, enabled = !busy) {
            Text(stringResource(R.string.invite_link_rotate))
        }
    }
}

@Composable
private fun DeviceRow(
    device: AccountDevice,
    enabled: Boolean,
    onRevoke: () -> Unit,
) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text =
                    when (device.platform) {
                        Platform.ANDROID -> "Android"
                        Platform.IOS -> "iPhone"
                    },
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                text = stringResource(R.string.device_added, added(device.createdAt)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (device.current) {
                Text(
                    text = stringResource(R.string.device_this),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
        TextButton(onClick = onRevoke, enabled = enabled) { Text(stringResource(R.string.device_revoke)) }
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
        text = { Text(text) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

private fun added(millis: ULong): String =
    DateTimeFormatter
        .ofLocalizedDate(FormatStyle.MEDIUM)
        .format(Instant.ofEpochMilli(millis.toLong()).atZone(ZoneId.systemDefault()))

private const val QR_WIDTH = 0.7f
