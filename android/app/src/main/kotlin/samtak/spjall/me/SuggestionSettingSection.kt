package samtak.spjall.me

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import samtak.spjall.brand.R
import samtak.spjall.social.LocalSuggestionSetting
import samtak.spjall.ui.ProblemCard

/**
 * The switch for friend suggestions (decision 0114), under the notification levels as on the web. It is off the
 * screen while the setting is not provided or was not read, and a refused write names its problem under it.
 */
@Composable
internal fun ColumnScope.SuggestionSettingSection() {
    val setting = LocalSuggestionSetting.current ?: return
    LaunchedEffect(Unit) { setting.load() }
    val included = setting.state.included ?: return
    Label(R.string.suggestions_setting_title)
    Panel {
        Toggle(
            text = stringResource(R.string.suggestions_setting_label),
            hint = stringResource(R.string.suggestions_setting_hint),
            checked = included,
            enabled = !setting.state.busy,
            onChange = setting.set,
            modifier = Modifier.testTag("suggestion-setting"),
        )
    }
    setting.state.problem?.let { ProblemCard(it) { setting.load() } }
}
