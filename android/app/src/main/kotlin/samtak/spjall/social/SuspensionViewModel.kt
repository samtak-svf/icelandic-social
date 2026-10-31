package samtak.spjall.social

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.core.CoreException
import samtak.spjall.ui.Suspension

/**
 * Whether this account is suspended (decision 0115), read from the core's `me` when a social screen opens and again
 * when the app returns, so a lift shows without a restart. A failed read keeps what was known: the server refuses a
 * write itself, and that refusal has its own words.
 */
class SuspensionViewModel(
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val now: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val _state = MutableStateFlow<Suspension?>(null)

    /** The suspension in force, or none; one whose end has passed is none. */
    val state: StateFlow<Suspension?> = _state.asStateFlow()

    fun load() {
        viewModelScope.launch {
            try {
                val own = withContext(io) { social.me() }
                _state.value = own.suspension?.takeIf { it.standsAt(now()) }
            } catch (_: CoreException) {
                // Keep what was known.
            }
        }
    }
}
