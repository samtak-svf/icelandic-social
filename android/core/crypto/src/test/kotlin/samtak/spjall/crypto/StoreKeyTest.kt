package samtak.spjall.crypto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import javax.crypto.AEADBadTagException
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** The wrapping logic, with a software AES key standing in for the Keystore. */
class StoreKeyTest {
    @get:Rule val folder = TemporaryFolder()

    private val wrapping: SecretKey = aes()

    private fun aes(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    private fun file() = File(folder.root, "store.key")

    @Test
    fun theFirstLoadMakesAKeyAndLaterLoadsReturnIt() {
        val first = StoreKey(file()) { wrapping }.load()
        assertEquals(32, first.size)
        assertArrayEquals(first, StoreKey(file()) { wrapping }.load())
    }

    @Test
    fun theFileHoldsTheKeyOnlyWrapped() {
        val key = StoreKey(file()) { wrapping }.load()
        val stored = file().readBytes()
        assertFalse(stored.toList().windowed(key.size).any { it == key.toList() })
        assertFalse(File(folder.root, "store.key.partial").exists())
    }

    @Test
    fun anotherWrappingKeyCannotUnwrapIt() {
        StoreKey(file()) { wrapping }.load()
        assertThrows(AEADBadTagException::class.java) { StoreKey(file()) { aes() }.load() }
    }

    @Test
    fun aTamperedFileIsRefused() {
        StoreKey(file()) { wrapping }.load()
        val bytes = file().readBytes()
        bytes[bytes.size - 1] = (bytes.last().toInt() xor 1).toByte()
        file().writeBytes(bytes)
        assertThrows(AEADBadTagException::class.java) { StoreKey(file()) { wrapping }.load() }
    }
}
