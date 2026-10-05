package samtak.spjall.crypto

import samtak.spjall.core.coreVersion
import samtak.spjall.core.envelopeVersion
import samtak.spjall.core.mlsSelfTest
import samtak.spjall.core.storeSelfTest
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
 * of two that exchanges a message, and the SQLite store opened in [storeDir]
 * with its migrations applied. Throws `CoreException` when any step fails.
 */
object CoreSelfTest {
    fun run(storeDir: File): CoreReport =
        CoreReport(
            version = coreVersion(),
            envelopeVersion = envelopeVersion(),
            mlsEpoch = mlsSelfTest(),
            storeSchema = storeSelfTest(storeDir.path),
        )
}
