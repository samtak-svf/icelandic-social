package samtak.spjall.ui

import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

/** Initials keep their size at every text size, since their circle does not grow (0053). */
class InitialsTest {
    @Test
    fun theFontScaleDoesNotChangeTheInitials() {
        val plain = with(Density(3f, fontScale = 1f)) { initialsSize(52.dp).toPx() }
        val large = with(Density(3f, fontScale = 2f)) { initialsSize(52.dp).toPx() }
        assertEquals(plain, large, 0.01f)
        assertEquals("a third of the circle", 52f * 3f * 0.33f, large, 0.01f)
    }
}
