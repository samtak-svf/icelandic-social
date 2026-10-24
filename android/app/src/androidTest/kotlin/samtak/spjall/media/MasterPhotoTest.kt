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

/** A photo leaves the device as an upright master without its metadata, uncropped (decisions 0039, 0086). */
@RunWith(AndroidJUnit4::class)
class MasterPhotoTest {
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

    private fun out() = File.createTempFile("master", ".jpg", dir)

    @Test
    fun aPhotoFromTheCameraLosesWhereItWasTakenAndKeepsWhichWayIsUp() {
        val taken = wide(300, 100, ExifInterface.ORIENTATION_ROTATE_90)
        assertTrue(ExifInterface(taken).latLong != null)
        stripLocation(taken.path)
        val exif = ExifInterface(taken)
        assertNull("no location goes with it (0047)", exif.latLong)
        assertNull(exif.getAttribute(ExifInterface.TAG_GPS_LATITUDE))
        assertEquals(ExifInterface.ORIENTATION_ROTATE_90, exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, 0))
        assertEquals(300, BitmapFactory.decodeFile(taken.path).width)
    }

    @Test
    fun aPickedPhotoLosesWhereItWasTakenInEachFormatThatCanBeWritten() {
        for ((mime, format) in listOf(
            "image/jpeg" to Bitmap.CompressFormat.JPEG,
            "image/png" to Bitmap.CompressFormat.PNG,
        )) {
            val picked = File.createTempFile("picked", ".img", dir)
            picked.outputStream().use { Bitmap.createBitmap(40, 30, Bitmap.Config.ARGB_8888).compress(format, 95, it) }
            ExifInterface(picked).apply {
                setLatLong(64.1, -21.9)
                saveAttributes()
            }
            assertTrue(mime, ExifInterface(picked).latLong != null)
            stripLocation(picked.path, mime)
            assertNull("no location goes with a picked $mime (0048)", ExifInterface(picked).latLong)
            assertEquals(40, BitmapFactory.decodeFile(picked.path).width)
        }
    }

    @Test
    fun aFormatThatCannotBeWrittenGoesAsItIs() {
        val picked = File.createTempFile("picked", ".heic", dir).apply { writeBytes(byteArrayOf(1, 2, 3)) }
        stripLocation(picked.path, "image/heic")
        assertEquals(listOf<Byte>(1, 2, 3), picked.readBytes().toList())
    }

    @Test
    fun aLargePhotoBecomesAMasterWithItsWholeFrameAndWithoutWhereItWasTaken() {
        val out = out()
        assertTrue(masterPhoto(wide(3000, 1000).path, out))
        val master = BitmapFactory.decodeFile(out.path)
        assertEquals(2400, master.width)
        assertEquals(800, master.height)
        assertTrue("the left is kept, not cropped away", Color.red(master.getPixel(10, 400)) > 200)
        assertTrue("the right is kept, not cropped away", Color.blue(master.getPixel(2390, 400)) > 200)
        assertNull("no location goes with it", ExifInterface(out).latLong)
    }

    @Test
    fun aSmallPhotoIsNotMadeLarger() {
        val out = out()
        assertTrue(masterPhoto(wide(300, 200).path, out))
        val master = BitmapFactory.decodeFile(out.path)
        assertEquals(300, master.width)
        assertEquals(200, master.height)
    }

    @Test
    fun aPhotoTakenSidewaysIsTurnedUpright() {
        val out = out()
        // Stored 600 x 300 but taken in portrait: upright it is 300 wide, so red is at the top.
        assertTrue(masterPhoto(wide(600, 300, ExifInterface.ORIENTATION_ROTATE_90).path, out))
        val master = BitmapFactory.decodeFile(out.path)
        assertEquals(300, master.width)
        assertEquals(600, master.height)
        val top = master.getPixel(150, 10)
        assertTrue("red is at the top", Color.red(top) > 200)
    }

    @Test
    fun aFileThatIsNotAnImageIsRefused() {
        val text = File.createTempFile("not", ".jpg", dir).apply { writeText("not a photo") }
        val out = out()
        assertFalse(masterPhoto(text.path, out))
    }
}
