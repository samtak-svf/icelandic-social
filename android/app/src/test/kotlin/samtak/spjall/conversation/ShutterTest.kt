package samtak.spjall.conversation

import org.junit.Assert.assertEquals
import org.junit.Test

/** The camera button asks for the camera before it opens it, and says so when refused (#323). */
class ShutterTest {
    private val calls = mutableListOf<String>()

    private fun shutter(
        allowed: Boolean,
        open: () -> Unit = { calls += "open" },
    ) = Shutter({ allowed }, { calls += "ask" }, open, { calls += "denied" })

    @Test
    fun aGrantedCameraOpensAtOnce() {
        shutter(allowed = true).press()
        assertEquals(listOf("open"), calls)
    }

    @Test
    fun anUngrantedCameraIsAskedForAndOpensOnYes() {
        val shutter = shutter(allowed = false)
        shutter.press()
        shutter.answered(granted = true)
        assertEquals(listOf("ask", "open"), calls)
    }

    @Test
    fun aRefusalSaysSoInsteadOfOpening() {
        val shutter = shutter(allowed = false)
        shutter.press()
        shutter.answered(granted = false)
        assertEquals(listOf("ask", "denied"), calls)
    }

    @Test
    fun aRefusedLaunchSaysSoInsteadOfAborting() {
        shutter(allowed = true, open = { throw SecurityException("camera") }).press()
        assertEquals(listOf("denied"), calls)
    }
}
