package samtak.spjall.crypto

import samtak.spjall.core.CoreStore
import samtak.spjall.core.coreVersion
import samtak.spjall.core.envelopeVersion
import samtak.spjall.core.mlsSelfTest
import java.io.File

/** What the Rust core reports about itself on this device. */
data class CoreReport(
    val version: String,
    val envelopeVersion: UInt,
    val mlsEpoch: ULong,
    val storeSchema: UInt,
)

/**
 * Proves the native library loads and works here: the version, an MLS group
 * of two that exchanges a message, and the encrypted store (decision 0016)
 * opened in [storeDir] with this device's key and its migrations applied.
 * Throws `CoreException` when any step fails.
 */
object CoreSelfTest {
    fun run(storeDir: File): CoreReport {
        val key = StoreKey.forDevice(storeDir).load()
        val storeSchema = CoreStore.open(storeDir.path, key).use { it.schemaVersion() }
        key.fill(0)
        return CoreReport(
            version = coreVersion(),
            envelopeVersion = envelopeVersion(),
            mlsEpoch = mlsSelfTest(),
            storeSchema = storeSchema,
        )
    }
}
