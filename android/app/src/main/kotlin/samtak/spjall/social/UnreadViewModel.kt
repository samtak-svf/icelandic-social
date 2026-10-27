package samtak.spjall.social

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.core.CoreException

/**
 * The count of notifications not yet seen on the notifications tab (decisions 0067, 0104): asked for when the tabs show and each time the
 * screen changes, as the web asks on every navigation. A failure keeps the count it had: the tab is no place
 * for an error.
 */
class UnreadViewModel(
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    private val _count = MutableStateFlow(0L)
    val count: StateFlow<Long> = _count.asStateFlow()

    private var job: Job? = null

    fun refresh() {
        job?.cancel()
        job =
            viewModelScope.launch {
                try {
                    _count.value = withContext(io) { social.notifications(null, 1u) }.unseen.toLong()
                } catch (_: CoreException) {
                    // Kept as it was; the next screen asks again.
                }
            }
    }
}
