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

    /** The blocked list: a circle struck through. */
    val Blocked = outline("blocked", 20f, 1.8f, "M17 10a7 7 0 1 1-14 0a7 7 0 1 1 14 0z", "M5 5l10 10")

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

    /** The first launch's notifications step (decision 0043): a bell. */
    val Bell = outline("bell", 20f, 1.8f, "M10 3a5 5 0 015 5v4l2 3H3l2-3V8a5 5 0 015-5z", "M8 17.5h4")

    val BellOff =
        outline("bell-off", 20f, 1.8f, "M10 3a5 5 0 015 5v4l2 3H3l2-3V8a5 5 0 015-5z", "M8 17.5h4", "M3 3l14 14")

    /** A message still on its way: a clock face at ten past. */
    val Clock = outline("clock", 16f, 1.6f, "M2 8a6 6 0 1 0 12 0a6 6 0 1 0-12 0z", "M8 4.5V8l2.5 1.5")

    /** The verified mark's shield, filled; [ShieldCheck] is drawn over it in another ink. */
    val Shield = filled("shield", 24f, "M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5l8-3z")

    val ShieldCheck = outline("shield-check", 24f, 2f, "M8.5 12l2.5 2.5 4.5-5")

    /**
     * Google's "G", in Google's own colours rather than the brand's, as its
     * sign-in guidelines ask; shown with `Image`, never tinted.
     */
    val GoogleG: ImageVector =
        ImageVector
            .Builder("google-g", 24.dp, 24.dp, 24f, 24f)
            .apply {
                listOf(
                    0xFF4285F4 to
                        "M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z",
                    0xFF34A853 to
                        "M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5" +
                        "H1.3v3.1A12 12 0 0 0 12 24z",
                    0xFFFBBC05 to "M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z",
                    0xFFEA4335 to
                        "M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z",
                ).forEach { (colour, path) -> addPath(pathData = addPathNodes(path), fill = SolidColor(Color(colour))) }
            }.build()

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
