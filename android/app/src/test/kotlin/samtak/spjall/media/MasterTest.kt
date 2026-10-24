package samtak.spjall.media

import org.junit.Assert.assertEquals
import org.junit.Test
import samtak.spjall.frames.ImageSize

class MasterTest {
    @Test
    fun aLargePhotoIsBroughtDownToALongEdgeOf2400() {
        assertEquals(ImageSize(2400, 1800), masterSize(4800, 3600))
        assertEquals(ImageSize(1350, 2400), masterSize(3024, 5376))
    }

    @Test
    fun aSmallPhotoIsNeverUpscaled() {
        assertEquals(ImageSize(800, 600), masterSize(800, 600))
        assertEquals(ImageSize(2400, 100), masterSize(2400, 100))
    }

    @Test
    fun theShortEdgeNeverRoundsToNothing() {
        assertEquals(ImageSize(2400, 1), masterSize(100000, 40))
    }

    @Test
    fun theFirstQualityThatFitsWins() {
        val sizes = mapOf(90 to 12L, 80 to 9L, 70 to 7L, 60 to 5L)
        assertEquals(80, masterQuality(10L) { sizes.getValue(it) })
        assertEquals(90, masterQuality(20L) { sizes.getValue(it) })
    }

    @Test
    fun whenNothingFitsTheLowestQualityIsUsed() {
        assertEquals(60, masterQuality(1L) { 100L })
    }
}
