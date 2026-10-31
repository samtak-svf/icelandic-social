package samtak.spjall.social

import samtak.spjall.core.Community
import samtak.spjall.core.HomePage
import samtak.spjall.core.Post
import samtak.spjall.core.PostImage
import samtak.spjall.core.PostPage
import samtak.spjall.core.PostTarget

/**
 * The home feed half of [FakeSocial], in memory: [homePages] are what `home` answers, one per call in order (an
 * empty `End` once they run out), [offered] the communities the composer offers, [written] what was posted.
 */
@Suppress("TooManyFunctions")
open class FakeSocialHome :
    FakeSocialNotifications(),
    SocialHome {
    val homePages = ArrayDeque<HomePage>()
    val offered = mutableListOf<Community>()

    /** The page size each `home` call asked for. */
    val limits = mutableListOf<UInt>()

    /** Each post written, with the target it went to and the media and the poll it carried. */
    class Written(
        val target: PostTarget,
        val body: String,
        val media: List<String>,
        val poll: List<String>?,
    )

    val written = mutableListOf<Written>()

    override fun feed(
        before: String?,
        limit: UInt,
    ): PostPage {
        call("feed")
        return PostPage(emptyList(), null)
    }

    override fun home(
        before: String?,
        limit: UInt,
    ): HomePage {
        call("home ${before.orEmpty()}".trim())
        limits += limit
        return homePages.removeFirstOrNull() ?: HomePage.End(emptyList())
    }

    override fun postCommunities(): List<Community> {
        call("postCommunities")
        return offered.toList()
    }

    override fun postTo(
        target: PostTarget,
        body: String,
        media: List<String>,
        poll: List<String>?,
    ): Post {
        call("postTo")
        written += Written(target, body, media, poll)
        return post("n${written.size}", communityId = "k1", body = body, author = self)
    }

    override fun uploadPostImageFor(
        target: PostTarget,
        path: String,
    ): PostImage {
        call("uploadPostImageFor $path")
        return PostImage("m1", 100u, 100u)
    }
}
