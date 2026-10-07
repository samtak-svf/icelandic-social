package samtak.spjall

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import samtak.spjall.brand.R

class SpjallApplication : Application() {
    val graph by lazy { AppGraph(this) }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        // Copies left by a run that ended before it deleted them.
        graph.files.clear()
        // The socket is open in the foreground only (decision 0022); push is a later batch.
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            object : DefaultLifecycleObserver {
                override fun onStart(owner: LifecycleOwner) = graph.socket.start()

                override fun onStop(owner: LifecycleOwner) = graph.socket.stop()
            },
        )
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
