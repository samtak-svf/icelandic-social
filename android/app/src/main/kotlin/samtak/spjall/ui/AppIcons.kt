package samtak.spjall.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/**
 * The app's line icons, drawn from the design's own paths so they match it
 * stroke for stroke. Each is tinted by `Icon`; the colour here is only ink.
 */
object AppIcons {
    /** The conversations tab: a speech bubble. */
    val Chat = outline("chat", 20f, 1.8f, "M3 6a3 3 0 013-3h8a3 3 0 013 3v5a3 3 0 01-3 3H8l-5 4V6z")

    /** The Ég tab: head and shoulders. */
    val Person =
        outline(
            "person",
            20f,
            1.8f,
            "M13.2 7a3.2 3.2 0 1 1-6.4 0a3.2 3.2 0 1 1 6.4 0z",
            "M4 17c0-3.3 2.7-5 6-5s6 1.7 6 5",
        )

    val Plus = outline("plus", 16f, 1.9f, "M8 3v10M3 8h10")

    val Back = outline("back", 20f, 2f, "M12 4l-6 6 6 6")

    /** The conversation's menu: three lines, the last one short. */
    val Menu = outline("menu", 20f, 1.8f, "M4 6h12M4 10h12M4 14h8")

    val Send = filled("send", 16f, "M2 14l12-6L2 2l2 6-2 6z")

    val Phone =
        outline(
            "phone",
            16f,
            1.6f,
            "M5.6 1.5h4.8a1.6 1.6 0 0 1 1.6 1.6v9.8a1.6 1.6 0 0 1-1.6 1.6" +
                "H5.6A1.6 1.6 0 0 1 4 12.9V3.1a1.6 1.6 0 0 1 1.6-1.6z",
            "M7 12.5h2",
        )

    val BellOff =
        outline("bell-off", 20f, 1.8f, "M10 3a5 5 0 015 5v4l2 3H3l2-3V8a5 5 0 015-5z", "M8 17.5h4", "M3 3l14 14")

    private fun outline(
        name: String,
        box: Float,
        stroke: Float,
        vararg paths: String,
    ): ImageVector =
        ImageVector
            .Builder(name, box.dp, box.dp, box, box)
            .apply {
                paths.forEach {
                    addPath(
                        pathData = addPathNodes(it),
                        stroke = SolidColor(Color.Black),
                        strokeLineWidth = stroke,
                        strokeLineCap = StrokeCap.Round,
                        strokeLineJoin = StrokeJoin.Round,
                    )
                }
            }.build()

    private fun filled(
        name: String,
        box: Float,
        path: String,
    ): ImageVector =
        ImageVector
            .Builder(name, box.dp, box.dp, box, box)
            .apply { addPath(pathData = addPathNodes(path), fill = SolidColor(Color.Black)) }
            .build()
}
