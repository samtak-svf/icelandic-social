package samtak.spjall.crypto

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The 32-byte SQLCipher key for the core's store (decision 0016). It is made
 * once on this device and kept in [file] only wrapped (AES-GCM) by a key that
 * never leaves the Android Keystore. [file] belongs in noBackupFilesDir: a
 * restored backup without the Keystore key could not unwrap it anyway.
 */
class StoreKey(
    private val file: File,
    private val wrappingKey: () -> SecretKey,
) {
    /** The key, made and stored wrapped on first use. */
    fun load(): ByteArray = if (file.exists()) unwrap(file.readBytes()) else create()

    private fun create(): ByteArray {
        val key = ByteArray(KEY_BYTES).also(SecureRandom()::nextBytes)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, wrappingKey())
        val wrapped = cipher.iv + cipher.doFinal(key)
        // Write then rename, so a crash never leaves half a key behind.
        val partial = File(file.parentFile, "${file.name}.partial")
        partial.writeBytes(wrapped)
        check(partial.renameTo(file)) { "could not store the wrapped key" }
        return key
    }

    private fun unwrap(wrapped: ByteArray): ByteArray {
        require(wrapped.size > IV_BYTES) { "the wrapped key is truncated" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        val iv = GCMParameterSpec(TAG_BITS, wrapped, 0, IV_BYTES)
        cipher.init(Cipher.DECRYPT_MODE, wrappingKey(), iv)
        return cipher.doFinal(wrapped, IV_BYTES, wrapped.size - IV_BYTES).also {
            check(it.size == KEY_BYTES) { "the unwrapped key is ${it.size} bytes" }
        }
    }

    companion object {
        private const val KEY_BYTES = 32
        private const val IV_BYTES = 12
        private const val TAG_BITS = 128
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val ALIAS = "spjall.store"
        private const val PROVIDER = "AndroidKeyStore"

        /** The device's key for the store in [dir], wrapped by the Keystore. */
        fun forDevice(dir: File): StoreKey = StoreKey(File(dir, "store.key"), ::keystoreKey)

        private fun keystoreKey(): SecretKey {
            val keyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }
            (keyStore.getKey(ALIAS, null) as SecretKey?)?.let { return it }
            val spec =
                KeyGenParameterSpec
                    .Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build()
            return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER).run {
                init(spec)
                generateKey()
            }
        }
    }
}
