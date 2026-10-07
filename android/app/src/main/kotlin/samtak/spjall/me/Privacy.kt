package samtak.spjall.me

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Person
import samtak.spjall.core.Settings
import samtak.spjall.ui.VerifiedMark
import samtak.spjall.ui.shownName

/** The read-marker and typing toggles (0022): off stops both sending and seeing. */
@Composable
internal fun PrivacySection(
    settings: Settings,
    enabled: Boolean,
    actions: MeActions,
) {
    Toggle(
        text = stringResource(R.string.read_receipts_setting),
        hint = stringResource(R.string.read_receipts_hint),
        checked = settings.readMarkers,
        enabled = enabled,
        onChange = actions::readMarkers,
    )
    Toggle(
        text = stringResource(R.string.typing_setting),
        hint = null,
        checked = settings.typing,
        enabled = enabled,
        onChange = actions::typing,
    )
}

/** Who this account blocked (0024), newest first; unblock asks first. */
@Composable
internal fun ColumnScope.BlockedSection(
    blocked: List<Person>,
    enabled: Boolean,
    onUnblock: (String) -> Unit,
) {
    var unblocking by rememberSaveable { mutableStateOf<String?>(null) }
    Text(text = stringResource(R.string.blocked_title), style = MaterialTheme.typography.titleMedium)
    if (blocked.isEmpty()) {
        Text(
            text = stringResource(R.string.blocked_empty),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    blocked.forEach { person ->
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = person.shownName(),
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.weight(1f, fill = false),
            )
            if (person.verified) VerifiedMark()
            Column(modifier = Modifier.weight(1f), horizontalAlignment = Alignment.End) {
                TextButton(onClick = { unblocking = person.account }, enabled = enabled) {
                    Text(stringResource(R.string.unblock))
                }
            }
        }
    }
    unblocking?.let { account ->
        val name = blocked.firstOrNull { it.account == account }?.shownName() ?: return@let
        Confirm(
            text = stringResource(R.string.unblock_confirm, name),
            confirm = stringResource(R.string.unblock),
            onConfirm = {
                unblocking = null
                onUnblock(account)
            },
            onDismiss = { unblocking = null },
        )
    }
}

@Composable
private fun Toggle(
    text: String,
    hint: String?,
    checked: Boolean,
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onChange)
                .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 16.dp)) {
            Text(text = text, style = MaterialTheme.typography.bodyLarge)
            hint?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Switch(checked = checked, onCheckedChange = null, enabled = enabled)
    }
}
