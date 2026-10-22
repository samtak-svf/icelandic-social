package samtak.spjall.account

import org.junit.Assert.assertEquals
import org.junit.Test

class UpdateTest {
    @Test
    fun usesTheServerUpdateUrlWhenPresent() {
        val update = Update()
        update.required("0.9.0", " https://example.com/optin ")

        assertEquals("0.9.0", update.min.value)
        assertEquals("https://example.com/optin", update.url.value)
        assertEquals("https://example.com/optin", update.link("https://fallback.example"))
    }

    @Test
    fun fallsBackWhenTheServerUpdateUrlIsMissingOrBlank() {
        val update = Update()
        update.required("0.9.0")
        assertEquals("https://fallback.example", update.link("https://fallback.example"))

        update.required("0.9.0", "  ")
        assertEquals(null, update.url.value)
        assertEquals("https://fallback.example", update.link("https://fallback.example"))
    }
}
