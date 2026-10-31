package samtak.spjall.social

import samtak.spjall.core.CommunityImage
import samtak.spjall.core.CommunityImagePage
import samtak.spjall.core.Frame
import samtak.spjall.core.Framing
import samtak.spjall.core.Post
import samtak.spjall.core.PostImage
import samtak.spjall.core.PostPage
import samtak.spjall.core.WallAudience
import samtak.spjall.core.WallProfile

/** An account's wall as the wall tabs get it. */
fun wallOf(
    accountId: String,
    bio: String? = null,
    cover: String? = null,
) = WallProfile(
    accountId = accountId,
    wallId = "w-$accountId",
    bio = bio,
    cover = cover,
    coverFrames = null,
    joinedMonth = "2026-03",
)

/** The wall half of [FakeSocial], in memory (0115): what a test puts in [walls] and [wallPostsOf] is what it reads. */
@Suppress("TooManyFunctions")
open class FakeSocialWall :
    FakeSocialHome(),
    SocialWall {
    val walls = mutableMapOf<String, WallProfile>()
    val wallPostsOf = mutableMapOf<String, MutableList<Post>>()

    /** Set, the wall's posts come in pages of this size; the cursor is the last post's id. */
    var wallPageSize: Int? = null
    val wallImagesOf = mutableMapOf<String, List<CommunityImage>>()

    /** What the next wall write answers with instead of succeeding; a test sets it to a refusal. */
    var wallFailure: Throwable? = null

    /** The media and the poll the last wall post was written with. */
    var lastWallMedia: List<String> = emptyList()
    var lastWallPoll: List<String>? = null

    private fun failing() {
        wallFailure?.let { throw it }
    }

    override fun wall(accountId: String): WallProfile {
        call("wall $accountId")
        return walls[accountId] ?: wallOf(accountId)
    }

    override fun wallPosts(
        accountId: String,
        before: String?,
    ): PostPage {
        call("wallPosts $accountId ${before.orEmpty()}".trim())
        val all = wallPostsOf[accountId].orEmpty().toList()
        val size = wallPageSize ?: return PostPage(all, null)
        val rest = if (before == null) all else all.drop(all.indexOfFirst { it.postId == before } + 1)
        return PostPage(rest.take(size), if (rest.size > size) rest[size - 1].postId else null)
    }

    override fun wallImages(
        accountId: String,
        cursor: String?,
    ): CommunityImagePage {
        call("wallImages $accountId")
        return CommunityImagePage(wallImagesOf[accountId].orEmpty(), null)
    }

    override fun createWallPost(
        body: String,
        media: List<String>,
        poll: List<String>?,
        audience: WallAudience,
    ): Post {
        call("createWallPost $audience $body")
        failing()
        lastWallMedia = media
        lastWallPoll = poll
        return post("wp${wallPostsOf.values.sumOf { it.size } + 1}", communityId = "w-me", body = body, author = self)
            .copy(wallOwner = self.accountId, audience = audience)
            .also { wallPostsOf.getOrPut(self.accountId) { mutableListOf() }.add(0, it) }
    }

    override fun uploadWallImage(path: String): PostImage {
        call("uploadWallImage $path")
        failing()
        return PostImage("m1", 100u, 100u)
    }

    override fun setPostAudience(
        postId: String,
        audience: WallAudience,
    ) {
        call("setPostAudience $postId $audience")
        failing()
    }

    override fun setBio(bio: String) {
        call("setBio $bio".trim())
        failing()
        walls[self.accountId] = walls[self.accountId]?.copy(bio = bio.ifBlank { null }) ?: wallOf(self.accountId, bio)
    }

    override fun setWallCover(path: String): String {
        call("setWallCover $path")
        walls[self.accountId] = wallOf(self.accountId, walls[self.accountId]?.bio, "2")
        return "2"
    }

    override fun removeWallCover() {
        call("removeWallCover")
        walls[self.accountId] = walls[self.accountId]?.copy(cover = null) ?: wallOf(self.accountId)
    }

    override fun setWallCoverFraming(framing: Framing): String {
        call("setWallCoverFraming")
        return "3"
    }

    override fun wallCoverFramed(
        accountId: String,
        version: String,
        frame: Frame,
    ): String? = null

    override fun wallCoverSource(path: String): Boolean = false

    override fun removeWallComment(
        commentId: String,
        reason: String,
    ) {
        call("removeWallComment $commentId $reason")
        failing()
    }
}
