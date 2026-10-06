package samtak.spjall

import android.content.Context
import okhttp3.OkHttpClient
import samtak.spjall.account.Account
import samtak.spjall.account.CoreAccount
import samtak.spjall.account.OkHttpTransport
import samtak.spjall.core.CoreClient
import samtak.spjall.crypto.StoreKey
import java.io.File

/** The objects the whole app shares, made once per process. */
class AppGraph(
    context: Context,
) {
    // noBackupFilesDir: the store and its wrapped key are device-local and never backed up
    // (decisions 0006, 0016).
    private val storeDir = File(context.noBackupFilesDir, "core")

    val account: Account =
        CoreAccount {
            storeDir.mkdirs()
            val key = StoreKey.forDevice(storeDir).load()
            try {
                CoreClient.open(storeDir.path, key, OkHttpTransport(BuildConfig.API_BASE_URL, OkHttpClient()))
            } finally {
                key.fill(0)
            }
        }
}
