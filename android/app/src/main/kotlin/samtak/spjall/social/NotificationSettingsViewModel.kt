package samtak.spjall.social

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.account.Problem
import samtak.spjall.account.problem
import samtak.spjall.core.CoreException
import samtak.spjall.core.NotificationKindLevel
import samtak.spjall.core.NotificationLevel
import samtak.spjall.core.SocialNotificationKind

/** The levels a [kind] may be set to: a moderator's notice never goes below the app (decision 0106). */
internal fun allowedLevels(kind: SocialNotificationKind): List<NotificationLevel> =
    if (kind == SocialNotificationKind.MODERATED) {
        listOf(NotificationLevel.PUSH, NotificationLevel.IN_APP)
    } else {
        listOf(NotificationLevel.PUSH, NotificationLevel.IN_APP, NotificationLevel.OFF)
    }

/** The levels a community may be set to. */
internal val communityLevels = listOf(NotificationLevel.PUSH, NotificationLevel.IN_APP, NotificationLevel.OFF)

/** One stored community level, with the name the person knows the community by. */
data class CommunityLevelRow(
    val communityId: String,
    val name: String,
    val level: NotificationLevel,
)

/**
 * The notification levels (decisions 0106): one per kind and one per community, where the lower of the two wins on
 * the server. A level with nothing stored reads as push. A change is shown at once and put back if the core refuses.
 */
class NotificationSettingsViewModel(
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        val kinds: Map<SocialNotificationKind, NotificationLevel> = emptyMap(),
        /** Only the communities with a stored level. */
        val communities: Map<String, NotificationLevel> = emptyMap(),
        /** The names of the communities this account is in. */
        val names: Map<String, String> = emptyMap(),
        val loaded: Boolean = false,
        val problem: Problem? = null,
    ) {
        fun kind(kind: SocialNotificationKind): NotificationLevel = kinds[kind] ?: NotificationLevel.PUSH

        fun community(id: String): NotificationLevel = communities[id] ?: NotificationLevel.PUSH

        /** The stored community levels that have a name to show, by name. */
        fun rows(): List<CommunityLevelRow> =
            communities
                .mapNotNull { (id, level) -> names[id]?.let { CommunityLevelRow(id, it, level) } }
                .sortedBy { it.name }
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var asked = false

    /** Reads the stored levels once; the names of the communities are best effort. */
    fun load() {
        if (asked) return
        asked = true
        viewModelScope.launch {
            try {
                val settings = withContext(io) { social.notificationSettings() }
                val names =
                    try {
                        withContext(io) { social.myCommunities() }.associate { it.communityId to it.name }
                    } catch (_: CoreException) {
                        emptyMap()
                    }
                _state.update {
                    it.copy(
                        kinds = settings.kinds.associate { k -> k.kind to k.level },
                        communities = settings.communities.associate { c -> c.communityId to c.level },
                        names = names,
                        loaded = true,
                        problem = null,
                    )
                }
            } catch (e: CoreException) {
                asked = false
                _state.update { it.copy(problem = e.problem()) }
            }
        }
    }

    fun setKind(
        kind: SocialNotificationKind,
        level: NotificationLevel,
    ) {
        if (level !in allowedLevels(kind)) return
        val before = _state.value
        _state.update { it.copy(kinds = it.kinds + (kind to level)) }
        change(before) { social.setNotificationSettings(listOf(NotificationKindLevel(kind, level))) }
    }

    fun setCommunity(
        communityId: String,
        level: NotificationLevel,
    ) {
        val before = _state.value
        _state.update { it.copy(communities = it.communities + (communityId to level)) }
        change(before) { social.setCommunityNotificationLevel(communityId, level) }
    }

    private fun change(
        before: State,
        call: () -> Unit,
    ) {
        viewModelScope.launch {
            try {
                withContext(io) { call() }
            } catch (e: CoreException) {
                _state.update { it.copy(kinds = before.kinds, communities = before.communities, problem = e.problem()) }
            }
        }
    }
}
