package samtak.spjall.onboarding

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.lifecycle.ViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow

/** Whether this install has been through the first launch. */
interface OnboardingStore {
    var done: Boolean
}

/** In the app's preferences, which never leave the device (decision 0006), so a new install starts over. */
class PrefsOnboardingStore(
    context: Context,
) : OnboardingStore {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    override var done: Boolean
        get() = prefs.getBoolean(DONE, false)
        set(value) = prefs.edit { putBoolean(DONE, value) }

    private companion object {
        const val PREFS = "onboarding"
        const val DONE = "done"
    }
}

/**
 * The first launch (decision 0043): after sign-in and before the tabs, once per install, an optional photo and
 * then notifications. The system's notification prompt is asked for only through [ask], after the person tapped
 * to turn them on. [notificationsNeeded] is false where there is nothing to ask: Android 12 and earlier, which
 * have no runtime permission, or an install that already has it.
 */
class OnboardingViewModel(
    private val store: OnboardingStore,
    private val notificationsNeeded: () -> Boolean,
) : ViewModel() {
    enum class Step { Photo, Notifications, Done }

    private val _step = MutableStateFlow(if (store.done) Step.Done else Step.Photo)
    val step: StateFlow<Step> = _step.asStateFlow()

    private val _ask = Channel<Unit>(Channel.BUFFERED)

    /** The system's notification prompt, for the activity to show. */
    val ask: Flow<Unit> = _ask.receiveAsFlow()

    /** Past the photo, set or skipped. */
    fun photoDone() {
        if (_step.value != Step.Photo) return
        if (notificationsNeeded()) _step.value = Step.Notifications else finish()
    }

    /** "Kveikja á tilkynningum": only now the system's prompt. */
    fun enable() {
        if (_step.value == Step.Notifications) _ask.trySend(Unit)
    }

    /** The system's prompt was answered, either way. */
    fun asked() = finish()

    /** "Ekki núna": no prompt; the notice on the list stays the way back. */
    fun notNow() = finish()

    private fun finish() {
        store.done = true
        _step.value = Step.Done
    }
}

/** Whether the system has to be asked before the app may notify: from Android 13, until it is allowed. */
fun notificationsNeeded(context: Context): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
        PackageManager.PERMISSION_GRANTED
