package samtak.spjall.frames

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.account.Problem
import samtak.spjall.account.problem
import samtak.spjall.core.CoreException
import samtak.spjall.core.FrameKind
import samtak.spjall.core.Framing
import samtak.spjall.media.MASTER_LONGEST
import samtak.spjall.media.decodePhoto
import java.io.File
import java.io.IOException

/**
 * One image to frame (decision 0086): what to crop, where it came from and what saving does. The owner of the image
 * builds it, so one sheet serves a profile photo, a community picture, a cover and a community not yet made.
 */
class FrameRequest(
    val kind: FrameKind,
    /** How the image is framed now; null for a new one. */
    val base: Framing?,
    /** The master to crop, or null when there is none (an image set before masters were kept). Off the main thread. */
    val master: suspend () -> File?,
    /** Sends the person's framing, and the master first when it is new. Throws [CoreException]. Off the main thread. */
    val save: suspend (Framing) -> Unit,
    /** Called with the master once the sheet closes, and whether it was saved. The default deletes the file. */
    val release: (File, Boolean) -> Unit = { file, _ -> file.delete() },
)

/** What the sheet shows. */
sealed interface FrameState {
    data object Closed : FrameState

    data object Loading : FrameState

    /** The image has no master to frame again (`image_frames_no_master`), or it could not be had; no sheet. */
    data class Unavailable(
        val problem: Problem? = null,
    ) : FrameState

    data class Editing(
        val request: FrameRequest,
        val image: ImageBitmap,
        val saving: Boolean = false,
        val problem: Problem? = null,
    ) : FrameState
}

/**
 * The one crop sheet of the app, owned by the activity so a picker result that arrives after a rotation still finds
 * it. [open] starts a request; the sheet's Save runs [save], Cancel runs [close].
 */
class FrameSession(
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    private val _state = MutableStateFlow<FrameState>(FrameState.Closed)
    val state: StateFlow<FrameState> = _state.asStateFlow()

    private var job: Job? = null
    private var file: File? = null

    /** Opens the sheet on [request]: loads its master, then shows the crop. */
    fun open(request: FrameRequest) {
        job?.cancel()
        finish(saved = false)
        _state.value = FrameState.Loading
        job =
            viewModelScope.launch {
                _state.value =
                    try {
                        withContext(io) { load(request) }
                    } catch (_: CoreException.NoMaster) {
                        FrameState.Unavailable()
                    } catch (e: CoreException) {
                        FrameState.Unavailable(e.problem())
                    } catch (_: IOException) {
                        FrameState.Unavailable(Problem.Generic())
                    }
            }
    }

    private suspend fun load(request: FrameRequest): FrameState {
        val master = request.master()
        file = master
        val bitmap = master?.let { decodePhoto(it.path, MASTER_LONGEST) }
        return when {
            master == null -> FrameState.Unavailable()
            bitmap == null -> FrameState.Unavailable(Problem.Generic())
            else -> FrameState.Editing(request, bitmap.asImageBitmap())
        }
    }

    /** Sends [framing] for the image being edited; the sheet closes when the core took it. */
    fun save(framing: Framing) {
        val editing = _state.value as? FrameState.Editing ?: return
        if (editing.saving) return
        _state.value = editing.copy(saving = true, problem = null)
        job =
            viewModelScope.launch {
                try {
                    withContext(io) { editing.request.save(framing) }
                    finish(saved = true)
                } catch (_: CoreException.NoMaster) {
                    finish(saved = false, shown = FrameState.Unavailable())
                } catch (e: CoreException) {
                    _state.value = editing.copy(saving = false, problem = e.problem())
                } catch (_: IOException) {
                    _state.value = editing.copy(saving = false, problem = Problem.Generic())
                }
            }
    }

    /** Closes the sheet without sending anything. */
    fun close() {
        job?.cancel()
        finish(saved = false)
    }

    private fun finish(
        saved: Boolean,
        shown: FrameState = FrameState.Closed,
    ) {
        val editing = _state.value as? FrameState.Editing
        val master = file
        file = null
        if (editing != null && master != null) editing.request.release(master, saved)
        _state.value = shown
    }

    override fun onCleared() {
        finish(saved = false)
    }
}
