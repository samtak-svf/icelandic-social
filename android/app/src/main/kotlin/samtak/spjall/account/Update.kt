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
    private val floor = MutableStateFlow<String?>(null)

    val min: StateFlow<String?> = floor.asStateFlow()

    fun required(min: String) {
        floor.value = min
    }
}
