package samtak.spjall.social

import samtak.spjall.BuildConfig

/** The web addresses of a community and a post, the ones a person can share or copy (0080). */
internal object SocialLinks {
    private val ORIGIN = BuildConfig.WEB_BASE_URL

    fun community(communityId: String) = "$ORIGIN/communities/$communityId"

    fun post(postId: String) = "$ORIGIN/posts/$postId"
}
