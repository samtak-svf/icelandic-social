package samtak.spjall.social

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.account.Problem
import samtak.spjall.account.problem
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CoreException
import java.io.File

/** Creating a community (decision 0063): its name, description and audience, then into it. */
class CreateCommunityViewModel(
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        val name: String = "",
        val description: String = "",
        val audience: CommunityAudience = CommunityAudience.OPEN,
        val hasPicture: Boolean = false,
        val hasCover: Boolean = false,
        val busy: Boolean = false,
        val problem: Problem? = null,
    ) {
        val ready: Boolean get() = name.isNotBlank() && !busy
    }

    // What cuts the picked picture and cover to size; run once the community exists, on the IO dispatcher.
    private var picture: (() -> File)? = null
    private var cover: (() -> File)? = null

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _created = Channel<String>(Channel.BUFFERED)

    /** The community made, to go into. */
    val created: Flow<String> = _created.receiveAsFlow()

    fun name(text: String) {
        if (text.length <= NAME_LIMIT) _state.update { it.copy(name = text) }
    }

    fun description(text: String) {
        if (text.length <= DESCRIPTION_LIMIT) _state.update { it.copy(description = text) }
    }

    fun audience(audience: CommunityAudience) {
        _state.update { it.copy(audience = audience) }
    }

    fun pickPicture(read: () -> File) {
        picture = read
        _state.update { it.copy(hasPicture = true) }
    }

    fun pickCover(read: () -> File) {
        cover = read
        _state.update { it.copy(hasCover = true) }
    }

    fun removePicture() {
        picture = null
        _state.update { it.copy(hasPicture = false) }
    }

    fun removeCover() {
        cover = null
        _state.update { it.copy(hasCover = false) }
    }

    fun create() {
        val state = _state.value
        if (!state.ready) return
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                val made =
                    withContext(io) {
                        social.createCommunity(state.name.trim(), state.description.trim(), state.audience)
                    }
                // The community stands even when a picture is refused; it can be set again from Breyta.
                withContext(io) {
                    attach(made.communityId, picture, Social::setCommunityAvatar)
                    attach(made.communityId, cover, Social::setCommunityCover)
                }
                _state.update { it.copy(busy = false) }
                _created.send(made.communityId)
            } catch (e: CoreException) {
                _state.update { it.copy(busy = false, problem = e.problem()) }
            }
        }
    }

    private fun attach(
        communityId: String,
        read: (() -> File)?,
        send: Social.(String, String) -> String,
    ) {
        val file = read?.invoke() ?: return
        try {
            social.send(communityId, file.path)
        } catch (_: CoreException) {
            // Left unset.
        } finally {
            file.delete()
        }
    }
}
