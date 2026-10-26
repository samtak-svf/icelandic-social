package samtak.spjall.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.io.File

/** Reads a group's photo from its path, as [PhotoCache] does with the file the core keeps (0094). */
object FilePhotos : Photos {
    override fun kept(photo: PhotoOf): ImageBitmap? = decode(photo)

    override suspend fun load(photo: PhotoOf): ImageBitmap? = decode(photo)

    private fun decode(photo: PhotoOf): ImageBitmap? =
        if (photo.kind == PhotoKind.GroupFile) BitmapFactory.decodeFile(photo.owner)?.asImageBitmap() else null
}

/** A square photo drawn at run time (two colour bands), so no picture of anyone is in git. */
fun squarePhoto(
    into: File,
    top: Int,
    bottom: Int,
): String {
    val side = 256
    val bitmap = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawRect(0f, 0f, side.toFloat(), side / 2f, Paint().apply { color = top })
    canvas.drawRect(0f, side / 2f, side.toFloat(), side.toFloat(), Paint().apply { color = bottom })
    into.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
    return into.path
}
