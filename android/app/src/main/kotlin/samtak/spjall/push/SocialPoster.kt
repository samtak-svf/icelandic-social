package samtak.spjall.push

import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import samtak.spjall.BuildConfig
import samtak.spjall.MainActivity
import samtak.spjall.brand.R
import samtak.spjall.social.SocialRoutes
import samtak.spjall.R as AppR

/** Social notifications (0107): one per notification id on the alerts channel; a tap opens the post. */
internal class SocialPoster(
    private val context: Context,
    private val manager: NotificationManagerCompat,
) {
    // Posting without the permission does nothing; areNotificationsEnabled says whether it would.
    @SuppressLint("MissingPermission")
    fun show(announcements: List<SocialAnnouncement>) {
        if (!manager.areNotificationsEnabled()) return
        announcements.forEach { manager.notify(it.notificationId, ID, build(it)) }
    }

    fun cancel(notificationIds: List<String>) = notificationIds.forEach { manager.cancel(it, ID) }

    /** The title is the app's, the text the row's sentence; never a snippet, since the screen may be locked. */
    private fun build(announcement: SocialAnnouncement): Notification =
        NotificationCompat
            .Builder(context, BuildConfig.CHANNEL_ALERTS)
            .setSmallIcon(AppR.drawable.ic_notification)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setAutoCancel(true)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(announcement.text)
            .setContentIntent(open(announcement))
            .build()

    /** Opens the post, or its community when there is none. The data keeps one intent per notification. */
    private fun open(announcement: SocialAnnouncement): PendingIntent {
        val route =
            announcement.postId?.let { SocialRoutes.post(it) } ?: SocialRoutes.community(announcement.communityId)
        val intent =
            Intent(context, MainActivity::class.java)
                .setAction(MainActivity.ACTION_OPEN_SOCIAL)
                .setData(Uri.fromParts(SCHEME, announcement.notificationId, null))
                .putExtra(MainActivity.EXTRA_ROUTE, route)
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private companion object {
        const val ID = 2
        const val SCHEME = "notification"
    }
}
