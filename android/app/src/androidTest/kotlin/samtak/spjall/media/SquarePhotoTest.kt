package samtak.spjall.media

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.exifinterface.media.ExifInterface
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** A profile photo leaves the device small, square, upright and without its metadata (decision 0039). */
@RunWith(AndroidJUnit4::class)
class SquarePhotoTest {
    private val dir = InstrumentationRegistry.getInstrumentation().targetContext.cacheDir

    /** A wide photo: red on the left third, green in the middle, blue on the right, taken somewhere. */
    private fun wide(
        width: Int,
        height: Int,
        orientation: Int = ExifInterface.ORIENTATION_NORMAL,
    ): File {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        for (x in 0 until width) {
            val color =
                when (x * 3 / width) {
                    0 -> Color.RED
                    1 -> Color.GREEN
                    else -> Color.BLUE
                }
            for (y in 0 until height) bitmap.setPixel(x, y, color)
        }
        val file = File.createTempFile("wide", ".jpg", dir)
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it) }
        ExifInterface(file).apply {
            setLatLong(64.1, -21.9)
            setAttribute(ExifInterface.TAG_ORIENTATION, orientation.toString())
            saveAttributes()
        }
        return file
    }

    private fun out() = File.createTempFile("square", ".jpg", dir)

    @Test
    fun aLargePhotoBecomesASmallSquareFromItsMiddleWithoutWhereItWasTaken() {
        val out = out()
        assertTrue(squarePhoto(wide(3000, 1000).path, out, 512))
        val square = BitmapFactory.decodeFile(out.path)
        assertEquals(512, square.width)
        assertEquals(512, square.height)
        val middle = square.getPixel(256, 256)
        assertTrue("the middle third is kept", Color.green(middle) > 200 && Color.red(middle) < 60)
        assertNull("no location goes with it", ExifInterface(out).latLong)
    }

    @Test
    fun aSmallPhotoIsNotMadeLarger() {
        val out = out()
        assertTrue(squarePhoto(wide(300, 200).path, out, 512))
        val square = BitmapFactory.decodeFile(out.path)
        assertEquals(200, square.width)
        assertEquals(200, square.height)
    }

    @Test
    fun aPhotoTakenSidewaysIsTurnedUpright() {
        val out = out()
        // Stored 600 x 300 but taken in portrait: upright it is 300 wide, so red is at the top.
        assertTrue(squarePhoto(wide(600, 300, ExifInterface.ORIENTATION_ROTATE_90).path, out, 512))
        val square = BitmapFactory.decodeFile(out.path)
        assertEquals(300, square.width)
        val top = square.getPixel(150, 10)
        assertTrue("red is at the top", Color.red(top) > 200)
    }

    @Test
    fun aFileThatIsNotAnImageIsRefused() {
        val text = File.createTempFile("not", ".jpg", dir).apply { writeText("not a photo") }
        val out = out()
        assertFalse(squarePhoto(text.path, out, 512))
    }
}
