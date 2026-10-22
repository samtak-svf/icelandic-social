package samtak.spjall.account

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The server's floor (decision 0030). Once any answer says this build is
 * below it, [min] holds the lowest version served and the app shows only the
 * update screen until the person installs a newer build.
 */
class Update {
    private val _min = MutableStateFlow<String?>(null)
    private val _url = MutableStateFlow<String?>(null)

    val min: StateFlow<String?> = _min.asStateFlow()
    val url: StateFlow<String?> = _url.asStateFlow()

    fun required(
        min: String,
        url: String? = null,
    ) {
        _min.value = min
        _url.value = url?.trim()?.takeIf { it.isNotEmpty() }
    }

    /** The server-published update URL when present, else the brand's fallback URL (#99). */
    fun link(fallback: String): String = _url.value ?: fallback
}
