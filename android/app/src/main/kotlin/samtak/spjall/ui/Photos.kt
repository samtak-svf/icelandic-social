package samtak.spjall.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import samtak.spjall.account.Account
import samtak.spjall.core.Conversation
import samtak.spjall.core.CoreException
import samtak.spjall.core.Person
import samtak.spjall.media.decodePhoto

/** An account's profile photo at the version the server named (decision 0039). */
data class PhotoOf(
    val account: String,
    val version: String,
)

/** The photo to draw for this person, or null when the server gave none. */
fun Person.photoOf(): PhotoOf? = photo?.let { PhotoOf(account, it) }

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

/** Where [Avatar] gets photos from. */
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
                account.photo(photo.account, photo.version)
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

/** [Photos] over the core, decoded at no more than [SIDE] px. */
class CorePhotos(
    account: Account,
) : Photos {
    private val cache = PhotoCache(account) { decodePhoto(it, SIDE)?.asImageBitmap() }

    override fun kept(photo: PhotoOf) = cache.kept(photo)

    override suspend fun load(photo: PhotoOf) = cache.load(photo)

    private companion object {
        // The server's 512 px photo, halved: about the largest avatar (88 dp) on most screens,
        // at a quarter of the memory.
        const val SIDE = 256
    }
}
