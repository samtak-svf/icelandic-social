package samtak.spjall.social

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.account.Problem
import samtak.spjall.account.problem
import samtak.spjall.core.CoreException

/**
 * Whether this account takes part in friend suggestions (decision 0114): off, nobody is suggested to it and it is
 * suggested to nobody. The switch shows what the server has; a write is read back, and a refused one leaves it be.
 */
class SuggestionSettingViewModel(
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        /** What the server holds, none until it was read. */
        val included: Boolean? = null,
        val busy: Boolean = false,
        val problem: Problem? = null,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    /** Reads the setting; read again after a problem (the retry), never repeated once it is known, never while held. */
    fun load() {
        val now = _state.value
        if (now.busy || (now.included != null && now.problem == null)) return
        run { }
    }

    fun set(included: Boolean) {
        if (_state.value.busy) return
        run { social.setFriendSuggestionsIncluded(included) }
    }

    /** Runs [write], if any, then reads the setting back. */
    private fun run(write: () -> Unit) {
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                val now =
                    withContext(io) {
                        write()
                        social.friendSuggestionsIncluded()
                    }
                _state.update { it.copy(included = now, busy = false) }
            } catch (e: CoreException) {
                _state.update { it.copy(busy = false, problem = e.problem()) }
            }
        }
    }
}

/** The setting and the calls that change it, for the screen that shows the switch. */
class SuggestionSetting(
    val state: SuggestionSettingViewModel.State,
    val load: () -> Unit,
    val set: (Boolean) -> Unit,
)

/** Where a screen finds the setting; none in a screen test, and then no switch shows. */
val LocalSuggestionSetting = compositionLocalOf<SuggestionSetting?> { null }

/** Provides the setting to [content], read from the core when the switch first asks for it. */
@Composable
fun WithSuggestionSetting(
    social: Social,
    content: @Composable () -> Unit,
) {
    val model: SuggestionSettingViewModel =
        viewModel(key = "suggestion-setting") { SuggestionSettingViewModel(social) }
    val state by model.state.collectAsStateWithLifecycle()
    val setting = remember(state, model) { SuggestionSetting(state, model::load, model::set) }
    CompositionLocalProvider(LocalSuggestionSetting provides setting, content = content)
}
