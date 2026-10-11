package samtak.spjall.ui

import androidx.compose.animation.core.tween
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MotionTest {
    @Test
    fun removedAnimationsReduceMotion() {
        assertTrue(reducesMotion(0f))
        assertFalse(reducesMotion(1f))
        assertFalse(reducesMotion(0.5f))
    }

    @Test
    fun aRowHasNoAnimationWhenMotionIsReduced() {
        val spec = tween<Float>(300)
        assertNull(unlessReduced(reduce = true, spec))
        assertEquals(spec, unlessReduced(reduce = false, spec))
    }
}
