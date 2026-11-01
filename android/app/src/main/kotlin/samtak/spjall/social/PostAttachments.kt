package samtak.spjall.social

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.conversation.Picked
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/** What a post being written carries besides its text: picked images (paths), the poll's fields, a notice. */
data class Attached(
    val picked: List<String> = emptyList(),
    val poll: List<String>? = null,
    val notice: CommunityViewModel.ImageNotice? = null,
    private val pollRule: PollRule = CorePollRule,
) {
    /** Text, or text with images; a poll needs its text and valid options and takes no images. */
    fun postable(draft: String): Boolean =
        if (poll != null) pollRule.valid(draft, poll) else draft.isNotBlank() || picked.isNotEmpty()
}

/**
 * The images and the poll of a post being written, with the media id each image was given once uploaded so a
 * second try does not upload it again. The feed composer's; the rules are the ones [fitting] and [copyPicked]
 * give the community and wall composers.
 */
@Suppress("TooManyFunctions")
class PostAttachments(
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher,
    private val pollRule: PollRule = CorePollRule,
) {
    private val _state = MutableStateFlow(Attached(pollRule = pollRule))
    val state: StateFlow<Attached> = _state.asStateFlow()
    private val uploaded = ConcurrentHashMap<String, String>()

    fun room(): Int = (IMAGES - _state.value.picked.size).coerceAtLeast(0)

    /** Whether another image fits; when none does, says so instead of opening the picker. */
    fun roomForImage(): Boolean {
        val room = room() > 0
        if (!room) _state.update { it.copy(notice = CommunityViewModel.ImageNotice.TooMany) }
        return room
    }

    fun pick(picked: List<Picked>) {
        if (picked.isEmpty() || _state.value.poll != null || !roomForImage()) return
        val (taken, notice) = fitting(picked, room())
        _state.update { it.copy(notice = notice) }
        if (taken.isEmpty()) return
        scope.launch {
            copyPicked(
                taken,
                io,
                have = { _state.value.picked.size },
                add = { path -> _state.update { it.copy(picked = it.picked + path) } },
                failed = { _state.update { it.copy(notice = CommunityViewModel.ImageNotice.Invalid) } },
            )
        }
    }

    fun unpick(path: String) {
        _state.update { it.copy(picked = it.picked - path, notice = null) }
        uploaded -= path
        scope.launch { withContext(io) { File(path).delete() } }
    }

    fun togglePoll() = _state.update { it.copy(poll = PollDraft.toggled(it.poll, it.picked.isNotEmpty())) }

    fun option(
        index: Int,
        text: String,
    ) = _state.update { s -> s.poll?.let { s.copy(poll = PollDraft.withOption(it, index, text)) } ?: s }

    fun addOption() = _state.update { s -> s.poll?.let { s.copy(poll = PollDraft.added(it)) } ?: s }

    fun removeOption(index: Int) =
        _state.update { s -> s.poll?.let { s.copy(poll = PollDraft.removed(it, index)) } ?: s }

    fun showNotice(notice: CommunityViewModel.ImageNotice) = _state.update { it.copy(notice = notice) }

    fun clearNotice() = _state.update { it.copy(notice = null) }

    /** The media ids of the picked images, uploading those not yet uploaded with [upload] (off the main thread). */
    fun media(upload: (String) -> String): List<String> =
        _state.value.picked.map { path -> uploaded.getOrPut(path) { upload(path) } }

    /** A media id the server no longer knows (over a day old): the next try uploads again. */
    fun forgetUploads() = uploaded.clear()

    /** The post went out: the files are not needed and the fields are empty again. */
    suspend fun spent() {
        val files = _state.value.picked
        withContext(io) { files.forEach { File(it).delete() } }
        uploaded.clear()
        _state.value = Attached(pollRule = pollRule)
    }
}
