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

    /** The communities tab: one person in front of two (decision 0063). */
    val Communities =
        outline(
            "communities",
            20f,
            1.8f,
            "M12.6 7.5a2.6 2.6 0 1 1-5.2 0a2.6 2.6 0 1 1 5.2 0z",
            "M5.5 17c0-2.8 2-4.3 4.5-4.3s4.5 1.5 4.5 4.3",
            "M5.2 9.6a2 2 0 1 1 0-4",
            "M2 15.5c0-2 1.2-3.2 3-3.5",
            "M14.8 9.6a2 2 0 1 0 0-4",
            "M18 15.5c0-2-1.2-3.2-3-3.5",
        )

    /** The blocked list: a circle struck through. */
    val Blocked = outline("blocked", 20f, 1.8f, "M17 10a7 7 0 1 1-14 0a7 7 0 1 1 14 0z", "M5 5l10 10")

    val Plus = outline("plus", 16f, 1.9f, "M8 3v10M3 8h10")

    val Back = outline("back", 20f, 2f, "M12 4l-6 6 6 6")

    /** A padlock: a private community's audience line (0080). */
    val Lock = outline("lock", 20f, 1.8f, "M5 9h10v8H5z", "M7 9V6a3 3 0 016 0v3")

    /** A pin: a pinned community or post (0080). */
    val Pin = outline("pin", 20f, 1.8f, "M7 3h6l-1 5 3 3H5l3-3z", "M10 11v6")

    /** The conversation's menu: Android's own "more" mark, three dots in a column (0047). */
    val More = outline("more", 20f, 2.6f, "M10 4.5h.01", "M10 10h.01", "M10 15.5h.01")

    /** The composer's camera: a body and its lens. */
    val Camera =
        outline(
            "camera",
            20f,
            1.8f,
            "M3 7.5a2 2 0 012-2h1.8l1.4-2h3.6l1.4 2H15a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2v-7z",
            "M7 11a3 3 0 1 0 6 0a3 3 0 1 0-6 0z",
        )

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

    /** The message menu's actions (0054), each before its words. */
    val Reply = outline("reply", 20f, 1.8f, "M8 5L3 10l5 5", "M3 10h9a5 5 0 015 5v1")
    val Copy = outline("copy", 20f, 1.8f, "M7 7h9v10H7z", "M4 13V3h9")
    val Forward = outline("forward", 20f, 1.8f, "M12 5l5 5-5 5", "M17 10H8a5 5 0 00-5 5v1")
    val Edit = outline("edit", 20f, 1.8f, "M13.5 3.5l3 3L7 16H4v-3z")
    val Trash = outline("trash", 20f, 1.8f, "M3.5 6h13", "M8 6V3.5h4V6", "M5.5 6l1 11h7l1-11")

    /** The verified mark's shield, filled; [ShieldCheck] is drawn over it in another ink. */
    val Shield = filled("shield", 24f, "M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5l8-3z")

    val ShieldCheck = outline("shield-check", 24f, 2f, "M8.5 12l2.5 2.5 4.5-5")

    /** Into a conversation's information (0055): a circle with an "i" in it (0078). */
    val Info = outline("info", 24f, 2f, "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0z", "M12 8h.01", "M12 11.5v5")

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
