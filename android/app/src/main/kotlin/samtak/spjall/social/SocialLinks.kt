package samtak.spjall.social

/** The web addresses of a community and a post, the ones a person can share or copy (0080). */
internal object SocialLinks {
    private const val ORIGIN = "https://spjall.samtak.is"

    fun community(communityId: String) = "$ORIGIN/communities/$communityId"

    fun post(postId: String) = "$ORIGIN/posts/$postId"
}
