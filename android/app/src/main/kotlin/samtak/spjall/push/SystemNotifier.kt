package samtak.spjall.push

import android.annotation.SuppressLint
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationCompat.MessagingStyle
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import samtak.spjall.BuildConfig
import samtak.spjall.MainActivity
import samtak.spjall.brand.R
import samtak.spjall.R as AppR

/**
 * One `MessagingStyle` notification per conversation on the messages channel,
 * tagged with the conversation: a second push adds its messages to the one
 * already showing. A tap opens the conversation.
 */
class SystemNotifier(
    private val context: Context,
) : Notifier {
    private val manager = NotificationManagerCompat.from(context)

    fun labels() =
        Labels(
            unnamed = context.getString(R.string.person_unnamed),
            alone = context.getString(R.string.conversation_alone_title),
            photo = context.getString(R.string.photo),
            file = context.getString(R.string.file),
            post = context.getString(R.string.post_shared),
        )

    // Posting without the permission does nothing; areNotificationsEnabled says whether it would.
    @SuppressLint("MissingPermission")
    override fun show(announcements: List<Announcement>) {
        if (!manager.areNotificationsEnabled()) return
        announcements.forEach { manager.notify(it.conversation, ID, build(it)) }
    }

    override fun cancel(conversations: List<String>) = conversations.forEach { manager.cancel(it, ID) }

    @SuppressLint("MissingPermission")
    override fun fallback(shown: Boolean) {
        if (!shown) return manager.cancel(FALLBACK, ID)
        if (!manager.areNotificationsEnabled()) return
        val notification =
            builder(open(null))
                .setContentTitle(context.getString(R.string.app_name))
                .setContentText(context.getString(R.string.push_fallback_body))
                .build()
        manager.notify(FALLBACK, ID, notification)
    }

    private fun build(announcement: Announcement): android.app.Notification {
        val style =
            showing(announcement.conversation)
                ?: MessagingStyle(Person.Builder().setName(context.getString(R.string.notification_you)).build())
        style.conversationTitle = announcement.title
        style.isGroupConversation = announcement.group
        announcement.lines.forEach { line ->
            style.addMessage(line.text, line.ts, Person.Builder().setName(line.sender).build())
        }
        return builder(open(announcement.conversation))
            .setStyle(style)
            .setWhen(announcement.lines.last().ts)
            .build()
    }

    private fun builder(tap: PendingIntent) =
        NotificationCompat
            .Builder(context, BuildConfig.CHANNEL_MESSAGES)
            .setSmallIcon(AppR.drawable.ic_notification)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(tap)

    /** The conversation's notification still on screen, so new messages join the old. */
    private fun showing(conversation: String): MessagingStyle? =
        context
            .getSystemService(NotificationManager::class.java)
            .activeNotifications
            .firstOrNull { it.tag == conversation && it.id == ID }
            ?.let { MessagingStyle.extractMessagingStyleFromNotification(it.notification) }

    /** Opens the conversation, or the app for the fallback. The data keeps one intent per conversation. */
    private fun open(conversation: String?): PendingIntent {
        val intent =
            Intent(context, MainActivity::class.java)
                .setAction(MainActivity.ACTION_OPEN_CONVERSATION)
                .setData(Uri.fromParts(SCHEME, conversation ?: FALLBACK, null))
        conversation?.let { intent.putExtra(MainActivity.EXTRA_CONVERSATION, it) }
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private companion object {
        const val ID = 1
        const val FALLBACK = "fallback"
        const val SCHEME = "conversation"
    }
}
