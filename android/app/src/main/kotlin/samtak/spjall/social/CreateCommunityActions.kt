package samtak.spjall.social

import samtak.spjall.core.CommunityAudience

/** What [CreateCommunityScreen] can ask for. */
interface CreateCommunityActions {
    fun name(text: String)

    fun description(text: String)

    fun audience(audience: CommunityAudience)

    /** Opens the picker for the picture, or the cover, the community is made with (0080). */
    fun pickPicture()

    fun pickCover()

    fun removePicture()

    fun removeCover()

    fun create()

    fun back()
}
