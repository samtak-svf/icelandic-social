package samtak.spjall

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import samtak.spjall.crypto.CoreSelfTest
import samtak.spjall.network.HealthClient
import samtak.spjall.ui.SpjallTheme
import samtak.spjall.ui.StatusScreen
import java.io.File

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // noBackupFilesDir: the store and its wrapped key are device-local and never backed up
        // (decisions 0006, 0016).
        val storeDir = File(noBackupFilesDir, "core")
        val health = HealthClient(BuildConfig.API_BASE_URL)
        setContent {
            SpjallTheme {
                StatusScreen(
                    coreStatus = { coreLine(storeDir) },
                    apiStatus = { apiLine(health) },
                )
            }
        }
    }
}

/** One line of diagnostics; values and class names only, never user data (decision 0008). */
private fun coreLine(storeDir: File): String =
    runCatching {
        storeDir.mkdirs()
        val report = CoreSelfTest.run(storeDir)
        "core ${report.version} · envelope v${report.envelopeVersion} · " +
            "mls epoch ${report.mlsEpoch} · store v${report.storeSchema}"
    }.getOrElse { "core ✗ ${it.javaClass.simpleName}" }

private suspend fun apiLine(health: HealthClient): String =
    runCatching {
        val body = health.fetch()
        "api ${body.status.value} · min android ${body.minClientVersion.android}"
    }.getOrElse { "api ✗ ${it.javaClass.simpleName}" }
