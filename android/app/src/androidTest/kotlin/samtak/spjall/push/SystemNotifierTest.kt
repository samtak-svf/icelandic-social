package samtak.spjall.push

import android.Manifest
import android.app.NotificationManager
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationCompat.MessagingStyle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.brand.R

/** The notifications the system actually holds after a push and after a read. */
@RunWith(AndroidJUnit4::class)
class SystemNotifierTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val manager = context.getSystemService(NotificationManager::class.java)
    private val notifier = SystemNotifier(context)

    @Before
    fun allow() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            InstrumentationRegistry
                .getInstrumentation()
                .uiAutomation
                .grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        }
        manager.cancelAll()
    }

    @After
    fun clear() = manager.cancelAll()

    private fun showing() = manager.activeNotifications.associateBy { it.tag }

    /** The system applies a post or a cancel after the call returns. */
    private fun showingSoon(tags: Set<String>): Set<String> {
        val until = SystemClock.uptimeMillis() + WAIT_MS
        while (showing().keys != tags && SystemClock.uptimeMillis() < until) SystemClock.sleep(POLL_MS)
        return showing().keys
    }

    private fun messages(tag: String) =
        MessagingStyle
            .extractMessagingStyleFromNotification(showing().getValue(tag).notification)!!
            .messages
            .map { "${it.person?.name}: ${it.text}" }

    @Test
    fun aSecondPushAddsToTheConversationsNotificationAndAReadTakesItAway() {
        notifier.show(listOf(Announcement("c1", "Anna", false, listOf(Line("Anna", "hæ", 1L)))))
        notifier.show(
            listOf(
                Announcement("c1", "Anna", false, listOf(Line("Anna", "ertu þarna?", 2L))),
                Announcement("c2", "Jón, Anna", true, listOf(Line("Jón", "halló", 3L))),
            ),
        )

        assertEquals(setOf("c1", "c2"), showingSoon(setOf("c1", "c2")))
        assertEquals(listOf("Anna: hæ", "Anna: ertu þarna?"), messages("c1"))
        assertEquals(
            context.packageName,
            showing()
                .getValue("c1")
                .notification.contentIntent.creatorPackage,
        )

        notifier.cancel(listOf("c1"))
        assertEquals(setOf("c2"), showingSoon(setOf("c2")))
    }

    @Test
    fun theFallbackSaysOnlyThatSomethingArrived() {
        notifier.fallback(true)
        showingSoon(setOf("fallback"))
        val fallback = showing().values.single().notification
        assertEquals(context.getString(R.string.push_fallback_body), fallback.extras.getString("android.text"))

        notifier.fallback(false)
        assertEquals(emptySet<String>(), showingSoon(emptySet()))
    }

    private companion object {
        const val WAIT_MS = 5_000L
        const val POLL_MS = 50L
    }
}
