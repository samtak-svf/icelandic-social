package samtak.spjall.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import samtak.spjall.SpjallApplication
import kotlin.concurrent.thread

/**
 * Debug builds only: runs what a push runs, so notifications can be tried
 * without Firebase, with the app closed:
 *
 *     adb shell am broadcast --include-stopped-packages -a samtak.spjall.debug.PUSH -p is.samtak.spjall
 */
class DebugPushReceiver : BroadcastReceiver() {
    override fun onReceive(
        context: Context,
        intent: Intent,
    ) {
        val push = (context.applicationContext as SpjallApplication).graph.push
        val pending = goAsync()
        thread {
            try {
                push.wake()
            } finally {
                pending.finish()
            }
        }
    }
}
