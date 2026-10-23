package samtak.spjall.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import samtak.spjall.account.Account
import samtak.spjall.core.CardCommunity
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityMember
import samtak.spjall.core.Conversation
import samtak.spjall.core.CoreException
import samtak.spjall.core.Person
import samtak.spjall.media.decodePhoto
import samtak.spjall.social.Social

/** Whose image a [PhotoOf] is, and so which core call fetches it (decisions 0039, 0080). */
enum class PhotoKind { Account, CommunityPicture, CommunityCover }

/** An image at the version the server named: an account's photo (0039), or a community's picture or cover (0080). */
data class PhotoOf(
    /** The account id, or for the community kinds the community id. */
    val owner: String,
    val version: String,
    val kind: PhotoKind = PhotoKind.Account,
)

/** The rounded tile of a community's picture and initials (decisions 0079, 0080), in proportion to its [size]. */
fun communityTile(size: Dp): Shape = RoundedCornerShape(size * TILE_CORNER)

private const val TILE_CORNER = 0.25f

/** The photo to draw for this person, or null when the server gave none. */
fun Person.photoOf(): PhotoOf? = photo?.let { PhotoOf(account, it) }

/** The photo to draw for this member of a community, or null when the account has none. */
fun CommunityMember.photoOf(): PhotoOf? = photo?.let { PhotoOf(accountId, it) }

/** The community's round picture, or null when it has none. */
fun Community.pictureOf(): PhotoOf? = photo?.let { PhotoOf(communityId, it, PhotoKind.CommunityPicture) }

/** The community's wide cover, or null when it has none. */
fun Community.coverOf(): PhotoOf? = cover?.let { PhotoOf(communityId, it, PhotoKind.CommunityCover) }

/** The picture of the community a card is in, or null when it has none. */
fun CardCommunity.pictureOf(): PhotoOf? = photo?.let { PhotoOf(communityId, it, PhotoKind.CommunityPicture) }

/** A 1:1's photo is the other person's; a group's avatar stays initials (decision 0039). */
fun Conversation.photoOf(): PhotoOf? = members.singleOrNull()?.photoOf()

/** [Avatar] for one person: their photo, or their initials in the fill their mark sets. */
@Composable
fun Avatar(
    person: Person,
    modifier: Modifier = Modifier,
    size: Dp = AVATAR_SIZE.dp,
) {
    Avatar(
        person.name,
        modifier = modifier,
        kind = if (person.verified) AvatarKind.Verified else AvatarKind.Unverified,
        size = size,
        photo = person.photoOf(),
    )
}

/** [Avatar] for one member of a community: their photo, or their initials in the fill their mark sets. */
@Composable
fun Avatar(
    member: CommunityMember,
    modifier: Modifier = Modifier,
    size: Dp = AVATAR_SIZE.dp,
) {
    Avatar(
        member.name,
        modifier = modifier,
        kind = if (member.verified) AvatarKind.Verified else AvatarKind.Unverified,
        size = size,
        photo = member.photoOf(),
    )
}

/**
 * The image to draw for [photo]: what is already in memory at once, then what the core fetches, and null while it
 * loads, for none, or when it cannot be had now. Null without [LocalPhotos], as in a screen test that provides none.
 */
@Composable
fun rememberPhoto(photo: PhotoOf?): ImageBitmap? {
    val photos = LocalPhotos.current
    val image by produceState(photo?.let { photos?.kept(it) }, photos, photo) {
        value = if (photos == null || photo == null) null else photos.load(photo)
    }
    return image
}

/** A community's cover: the image across the band, or nothing while it loads or when it cannot be had. */
@Composable
fun CoverImage(
    photo: PhotoOf?,
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    val image = rememberPhoto(photo) ?: return
    Image(
        bitmap = image,
        contentDescription = contentDescription,
        contentScale = ContentScale.Crop,
        modifier = modifier,
    )
}

/** Where [Avatar] and [CoverImage] get photos from. */
interface Photos {
    /** The photo when it is already in memory, so a row drawn again does not flash its initials. */
    fun kept(photo: PhotoOf): ImageBitmap?

    /** The photo, fetched by the core when it has not kept it yet; null for none or when it cannot be had now. */
    suspend fun load(photo: PhotoOf): ImageBitmap?
}

/** Null draws initials only, as in a screen test that provides none. */
val LocalPhotos = staticCompositionLocalOf<Photos?> { null }

/**
 * Decoded photos by account and version, the last [capacity] in memory only.
 * The file stays the core's, in its media folder (decision 0039): nothing here
 * writes one.
 */
class PhotoCache<T : Any>(
    private val account: Account,
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val capacity: Int = CAPACITY,
    private val decode: (String) -> T?,
) {
    private val images =
        object : LinkedHashMap<PhotoOf, T>(capacity, LOAD, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<PhotoOf, T>) = size > capacity
        }

    fun kept(photo: PhotoOf): T? = synchronized(images) { images[photo] }

    suspend fun load(photo: PhotoOf): T? =
        kept(photo) ?: withContext(io) { fetch(photo) }?.also { synchronized(images) { images[photo] = it } }

    private fun fetch(photo: PhotoOf): T? {
        val path =
            try {
                when (photo.kind) {
                    PhotoKind.Account -> account.photo(photo.owner, photo.version)
                    PhotoKind.CommunityPicture -> social.communityPicture(photo.owner, photo.version)
                    PhotoKind.CommunityCover -> social.communityCover(photo.owner, photo.version)
                }
            } catch (_: CoreException) {
                // Offline, or refused: the initials stand in, and the next draw asks again.
                null
            }
        return path?.let(decode)
    }

    private companion object {
        const val CAPACITY = 64
        const val LOAD = 0.75f
    }
}

/** [Photos] over the core: pictures at no more than [SIDE] px, a cover at no more than [COVER_SIDE]. */
class CorePhotos(
    account: Account,
    social: Social,
) : Photos {
    // Two caches because the decoder is chosen by size, not by kind; the key still carries the kind.
    private val pictures = PhotoCache(account, social) { decodePhoto(it, SIDE)?.asImageBitmap() }
    private val covers = PhotoCache(account, social) { decodePhoto(it, COVER_SIDE)?.asImageBitmap() }

    private fun of(photo: PhotoOf) = if (photo.kind == PhotoKind.CommunityCover) covers else pictures

    override fun kept(photo: PhotoOf) = of(photo).kept(photo)

    override suspend fun load(photo: PhotoOf) = of(photo).load(photo)

    private companion object {
        // The server's 512 px photo, halved: about the largest avatar (88 dp) on most screens,
        // at a quarter of the memory.
        const val SIDE = 256

        // A cover spans the screen, so it keeps more of its 1600 px than a picture does.
        const val COVER_SIDE = 1280
    }
}
