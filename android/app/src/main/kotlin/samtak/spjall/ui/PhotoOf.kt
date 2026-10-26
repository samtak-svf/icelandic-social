package samtak.spjall.ui

import samtak.spjall.core.Author
import samtak.spjall.core.CardCommunity
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityMember
import samtak.spjall.core.Conversation
import samtak.spjall.core.Frame
import samtak.spjall.core.Person
import java.io.File

/** Whose image a [PhotoOf] is, and so which call fetches it (0039, 0080); a [GroupFile] is read from disk (0094). */
enum class PhotoKind { Account, CommunityPicture, CommunityCover, GroupFile }

/** An image at the version the server named: an account's photo (0039), or a community's picture or cover (0080). */
data class PhotoOf(
    /** The account id, or for the community kinds the community id, or for a [PhotoKind.GroupFile] its path. */
    val owner: String,
    val version: String,
    val kind: PhotoKind = PhotoKind.Account,
    /** The frame to fetch (0086): `SQUARE` for a photo or picture, the window's size class for a cover. */
    val frame: Frame = Frame.SQUARE,
)

/** The photo to draw for this person, or null when the server gave none. */
fun Person.photoOf(): PhotoOf? = photo?.let { PhotoOf(account, it) }

/** The photo to draw for the author of a post or comment, or null when the server gave none (0080). */
fun Author.photoOf(): PhotoOf? = photo?.let { PhotoOf(accountId, it) }

/** The photo to draw for this member of a community, or null when the account has none. */
fun CommunityMember.photoOf(): PhotoOf? = photo?.let { PhotoOf(accountId, it) }

/** The community's picture, or null when it has none. */
fun Community.pictureOf(): PhotoOf? = photo?.let { PhotoOf(communityId, it, PhotoKind.CommunityPicture) }

/** The community's wide cover, or null when it has none. */
fun Community.coverOf(): PhotoOf? = cover?.let { PhotoOf(communityId, it, PhotoKind.CommunityCover) }

/** The picture of the community a card is in, or null when it has none. */
fun CardCommunity.pictureOf(): PhotoOf? = photo?.let { PhotoOf(communityId, it, PhotoKind.CommunityPicture) }

/** Whether this is a group (0078): it has a name, or it is not exactly one other person. */
fun Conversation.isGroup(): Boolean = name != null || members.size != 1

/**
 * What changes when the core rewrites a photo file in place (0094): its modification time and its size, so a
 * replaced photo is another cache key. Zero for a file that is not there.
 */
fun fileStamp(path: String): Long = File(path).let { it.lastModified() * STAMP_MIX + it.length() }

private const val STAMP_MIX = 31L

/**
 * A group's own photo when it has one (0094), else a 1:1's is the other person's; a group without one stays
 * initials (decision 0039). [stamp] reads the file's version, so a test can name one.
 */
fun Conversation.photoOf(stamp: (String) -> Long = ::fileStamp): PhotoOf? =
    photo?.takeIf { isGroup() }?.let { PhotoOf(it, "${stamp(it)}", PhotoKind.GroupFile) }
        ?: members.singleOrNull()?.photoOf()
