package samtak.spjall

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.launch
import samtak.spjall.brand.R
import samtak.spjall.push.Fcm

class SpjallApplication : Application() {
    val graph by lazy { AppGraph(this) }

    private val background = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        // Copies left by a run that ended before it deleted them.
        graph.files.clear()
        // The socket is open in the foreground only (decision 0022), and push wakes the app
        // when it is not (0025). What arrives while it is open is on screen, so it is never
        // announced later: the core counts it as shown on each event and as the app closes.
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onStart(owner: LifecycleOwner) {
                    graph.socket.start()
                    quiet()
                }

                override fun onStop(owner: LifecycleOwner) {
                    graph.socket.stop()
                    quiet()
                }
            },
        )
        background.launch {
            graph.socket.events
                .conflate()
                .collect { graph.push.quiet() }
        }
        Fcm.start(this, graph.push)
    }

    private fun quiet() {
        background.launch { graph.push.quiet() }
    }

    /** The channel id is frozen (identifiers/ids.json); its name and description are brand strings. */
    private fun createNotificationChannels() {
        val messages =
            NotificationChannel(
                BuildConfig.CHANNEL_MESSAGES,
                getString(R.string.notification_channel_messages_name),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply { description = getString(R.string.notification_channel_messages_description) }
        getSystemService(NotificationManager::class.java).createNotificationChannel(messages)
    }
}
