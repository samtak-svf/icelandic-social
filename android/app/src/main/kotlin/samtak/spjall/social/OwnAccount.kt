package samtak.spjall.social

import samtak.spjall.core.Me
import samtak.spjall.ui.PhotoOf
import samtak.spjall.ui.Suspension

/**
 * This account as the social screens need it: its id to tell its own posts and comments from others', and its
 * name and photo for the avatar beside a box it writes in (decision 0080).
 */
data class OwnAccount(
    val id: String,
    val name: String?,
    val photo: PhotoOf?,
    /** Set while a platform moderator holds this account's writing (decision 0115); the end may be open. */
    val suspension: Suspension? = null,
)

/** The part of [Me] the social screens use. */
fun Me.own() =
    OwnAccount(accountId, name, photo?.let { PhotoOf(accountId, it) }, suspension?.let { Suspension(it.until) })
