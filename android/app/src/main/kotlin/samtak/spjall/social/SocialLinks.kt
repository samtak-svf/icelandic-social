package samtak.spjall.social

import samtak.spjall.BuildConfig

/** The web addresses of a community and a post, the ones a person can share or copy (0080). */
internal object SocialLinks {
    fun community(
        communityId: String,
        origin: String = BuildConfig.WEB_BASE_URL,
    ) = "$origin/communities/$communityId"

    fun post(
        postId: String,
        origin: String = BuildConfig.WEB_BASE_URL,
    ) = "$origin/posts/$postId"
}
