package samtak.spjall.social

import samtak.spjall.core.CommunityImagePage
import samtak.spjall.core.CoreClient
import samtak.spjall.core.Frame
import samtak.spjall.core.Framing
import samtak.spjall.core.Post
import samtak.spjall.core.PostImage
import samtak.spjall.core.PostPage
import samtak.spjall.core.WallAudience
import samtak.spjall.core.WallProfile

/** The wall calls of [Social] (decision 0115), apart so each file stays under the cap. */
@Suppress("TooManyFunctions")
interface SocialWall {
    /** An account's wall: bio, cover and the month it joined. */
    fun wall(accountId: String): WallProfile

    /** A page of an account's wall posts, newest first; an empty last page where this account may not read. */
    fun wallPosts(
        accountId: String,
        before: String?,
    ): PostPage

    /** A page of the images in an account's wall posts and comments. */
    fun wallImages(
        accountId: String,
        cursor: String?,
    ): CommunityImagePage

    /** Writes a post on this account's own wall; `Refused` 403 `suspended` while it is suspended. */
    fun createWallPost(
        body: String,
        media: List<String>,
        poll: List<String>?,
        audience: WallAudience,
    ): Post

    /** Uploads an image for a wall post. */
    fun uploadWallImage(path: String): PostImage

    /** Changes who may read a wall post of this account's. */
    fun setPostAudience(
        postId: String,
        audience: WallAudience,
    )

    /** Sets the bio; a blank one clears it, over 120 characters is `Invalid`. */
    fun setBio(bio: String)

    /** Sets the cover from the image at [path]; the new version. */
    fun setWallCover(path: String): String

    /** Removes the cover. */
    fun removeWallCover()

    /** Frames the cover again; the new version. */
    fun setWallCoverFraming(framing: Framing): String

    /** The path of an account's cover at [version] in [frame], or null when there is none. */
    fun wallCoverFramed(
        accountId: String,
        version: String,
        frame: Frame,
    ): String?

    /** Writes the cover's master to [path] for the editor; false when there is none. */
    fun wallCoverSource(path: String): Boolean

    /** Removes a comment on this account's wall, with the [reason] its writer reads (1 to 500 characters). */
    fun removeWallComment(
        commentId: String,
        reason: String,
    )
}

/** [SocialWall] over the core's client. */
@Suppress("TooManyFunctions")
class CoreWall(
    private val lazyClient: Lazy<CoreClient>,
) : SocialWall {
    private val client by lazyClient

    override fun wall(accountId: String) = client.wall(accountId)

    override fun wallPosts(
        accountId: String,
        before: String?,
    ) = client.wallPosts(accountId, before, WALL_PAGE)

    override fun wallImages(
        accountId: String,
        cursor: String?,
    ) = client.wallImages(accountId, cursor, WALL_PAGE)

    override fun createWallPost(
        body: String,
        media: List<String>,
        poll: List<String>?,
        audience: WallAudience,
    ) = client.createWallPost(body, media, poll, audience)

    override fun uploadWallImage(path: String) = client.uploadWallImage(path)

    override fun setPostAudience(
        postId: String,
        audience: WallAudience,
    ) = client.setPostAudience(postId, audience)

    override fun setBio(bio: String) = client.setBio(bio)

    override fun setWallCover(path: String) = client.setWallCover(path)

    override fun removeWallCover() = client.removeWallCover()

    override fun setWallCoverFraming(framing: Framing) = client.setWallCoverFraming(framing)

    override fun wallCoverFramed(
        accountId: String,
        version: String,
        frame: Frame,
    ) = client.wallCoverFramed(accountId, version, frame)

    override fun wallCoverSource(path: String) = client.wallCoverSource(path)

    override fun removeWallComment(
        commentId: String,
        reason: String,
    ) = client.removeWallComment(commentId, reason)

    private companion object {
        const val WALL_PAGE = 20u
    }
}
