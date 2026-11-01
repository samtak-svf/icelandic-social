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
import samtak.spjall.core.FrameKind
import samtak.spjall.core.Framing
import samtak.spjall.frames.FrameRequest
import samtak.spjall.frames.newImageRequest
import samtak.spjall.ui.fitsIn
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

    /** A master the person framed, kept until the community exists to send it to (0086). */
    private class Pending(
        val file: File,
        val framing: Framing,
    )

    private var picture: Pending? = null
    private var cover: Pending? = null

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _created = Channel<String>(Channel.BUFFERED)

    /** The community made, to go into. */
    val created: Flow<String> = _created.receiveAsFlow()

    fun name(text: String) {
        if (text.fitsIn(NAME_LIMIT)) _state.update { it.copy(name = text) }
    }

    fun description(text: String) {
        if (text.fitsIn(DESCRIPTION_LIMIT)) _state.update { it.copy(description = text) }
    }

    fun audience(audience: CommunityAudience) {
        _state.update { it.copy(audience = audience) }
    }

    /** The crop sheet's request for the picture picked; Save keeps master and framing for [create] (0086). */
    fun pictureRequest(read: () -> File): FrameRequest =
        newImageRequest(FrameKind.PHOTO, read, ::keepIfSaved) { file, framing ->
            picture?.file?.delete()
            picture = Pending(file, framing)
            _state.update { it.copy(hasPicture = true) }
        }

    /** The crop sheet's request for the cover picked. */
    fun coverRequest(read: () -> File): FrameRequest =
        newImageRequest(FrameKind.COVER, read, ::keepIfSaved) { file, framing ->
            cover?.file?.delete()
            cover = Pending(file, framing)
            _state.update { it.copy(hasCover = true) }
        }

    private fun keepIfSaved(
        file: File,
        saved: Boolean,
    ) {
        if (!saved) file.delete()
    }

    fun removePicture() {
        picture?.file?.delete()
        picture = null
        _state.update { it.copy(hasPicture = false) }
    }

    fun removeCover() {
        cover?.file?.delete()
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
                    attach(made.communityId, picture, Social::setCommunityAvatar, Social::setCommunityPictureFraming)
                    attach(made.communityId, cover, Social::setCommunityCover, Social::setCommunityCoverFraming)
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
        pending: Pending?,
        send: Social.(String, String) -> String,
        frame: Social.(String, Framing) -> String,
    ) {
        val kept = pending ?: return
        try {
            social.send(communityId, kept.file.path)
            social.frame(communityId, kept.framing)
        } catch (_: CoreException) {
            // Left unset.
        } finally {
            kept.file.delete()
        }
    }
}
