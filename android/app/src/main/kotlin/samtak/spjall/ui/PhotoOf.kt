package samtak.spjall.ui

import samtak.spjall.core.Author
import samtak.spjall.core.CardCommunity
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityMember
import samtak.spjall.core.Conversation
import samtak.spjall.core.Person

/** Whose image a [PhotoOf] is, and so which core call fetches it (decisions 0039, 0080). */
enum class PhotoKind { Account, CommunityPicture, CommunityCover }

/** An image at the version the server named: an account's photo (0039), or a community's picture or cover (0080). */
data class PhotoOf(
    /** The account id, or for the community kinds the community id. */
    val owner: String,
    val version: String,
    val kind: PhotoKind = PhotoKind.Account,
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

/** A 1:1's photo is the other person's; a group's avatar stays initials (decision 0039). */
fun Conversation.photoOf(): PhotoOf? = members.singleOrNull()?.photoOf()
