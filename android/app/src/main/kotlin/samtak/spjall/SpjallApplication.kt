package samtak.spjall

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import samtak.spjall.brand.R

class SpjallApplication : Application() {
    val graph by lazy { AppGraph(this) }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
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
