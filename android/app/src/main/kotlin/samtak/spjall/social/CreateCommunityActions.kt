package samtak.spjall.social

import samtak.spjall.core.CommunityAudience

/** What [CreateCommunityScreen] can ask for. */
interface CreateCommunityActions {
    fun name(text: String)

    fun description(text: String)

    fun audience(audience: CommunityAudience)

    fun create()

    fun back()
}
