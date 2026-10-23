package samtak.spjall.social

import samtak.spjall.core.Me
import samtak.spjall.ui.PhotoOf

/**
 * This account as the social screens need it: its id to tell its own posts and comments from others', and its
 * name and photo for the avatar beside a box it writes in (decision 0080).
 */
data class OwnAccount(
    val id: String,
    val name: String?,
    val photo: PhotoOf?,
)

/** The part of [Me] the social screens use. */
fun Me.own() = OwnAccount(accountId, name, photo?.let { PhotoOf(accountId, it) })
