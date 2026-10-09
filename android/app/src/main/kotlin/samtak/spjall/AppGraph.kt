package samtak.spjall

import android.content.Context
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import kotlinx.coroutines.MainScope
import okhttp3.OkHttpClient
import samtak.spjall.account.Account
import samtak.spjall.account.CoreAccount
import samtak.spjall.account.OkHttpTransport
import samtak.spjall.account.Update
import samtak.spjall.core.CoreClient
import samtak.spjall.core.Platform
import samtak.spjall.crypto.StoreKey
import samtak.spjall.media.Files
import samtak.spjall.push.Push
import samtak.spjall.push.SystemNotifier
import samtak.spjall.socket.OkHttpWire
import samtak.spjall.socket.Socket
import java.io.File

/** The objects the whole app shares, made once per process. */
class AppGraph(
    context: Context,
) {
    // noBackupFilesDir: the store and its wrapped key are device-local and never backed up
    // (decisions 0006, 0016).
    private val storeDir = File(context.noBackupFilesDir, "core")

    private val http = OkHttpClient()

    /** Set when the server no longer serves this build (decision 0030). */
    val update = Update()

    val account: Account =
        CoreAccount {
            storeDir.mkdirs()
            val key = StoreKey.forDevice(storeDir).load()
            try {
                CoreClient.open(
                    storeDir.path,
                    key,
                    OkHttpTransport(BuildConfig.API_BASE_URL, http, update::required),
                    Platform.ANDROID,
                    BuildConfig.VERSION_NAME,
                )
            } finally {
                key.fill(0)
            }
        }

    val files = Files(context)

    /** Open while the app is in the foreground (SpjallApplication). */
    val socket =
        Socket(
            account,
            // What the core names this build in every request (decision 0030).
            OkHttpWire(BuildConfig.API_BASE_URL, http, "android/${BuildConfig.VERSION_NAME}"),
            MainScope(),
        )

    private val notifier = SystemNotifier(context)

    val push =
        Push(account, notifier, notifier::labels) {
            ProcessLifecycleOwner
                .get()
                .lifecycle.currentState
                .isAtLeast(Lifecycle.State.STARTED)
        }
}
