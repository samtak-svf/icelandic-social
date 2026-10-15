package samtak.spjall.conversation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.account.Account
import samtak.spjall.account.Problem
import samtak.spjall.account.problem
import samtak.spjall.core.Body
import samtak.spjall.core.Content
import samtak.spjall.core.Conversation
import samtak.spjall.core.CoreException
import samtak.spjall.core.Event
import samtak.spjall.core.Item
import samtak.spjall.core.MuteFor
import samtak.spjall.socket.Live
import java.io.File
import java.io.IOException

/**
 * One conversation (decision 0022): its timeline as the core folds it, the
 * composer, and the long-press actions. It reads the newest page again on
 * every event for it, marks what is on screen read, sends typing frames, and
 * asks the core to expire items when the first of them is due.
 */
@Suppress("TooManyFunctions")
class ConversationViewModel(
    private val id: String,
    private val account: Account,
    private val live: Live,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val now: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    /** What the composer's text does when sent. */
    sealed interface Mode {
        data object New : Mode

        data class Reply(
            val item: Item,
        ) : Mode

        data class Edit(
            val item: Item,
        ) : Mode
    }

    /** A photo or file of the timeline, by seq. */
    sealed interface Media {
        data object Loading : Media

        data class Ready(
            val path: String,
        ) : Media

        data object Failed : Media
    }

    /** A photo or file picked and not sent yet (0048): the field's text goes with it as its caption. */
    data class Pending(
        val path: String,
        val mime: String,
        val name: String?,
    ) {
        val photo: Boolean get() = mime.startsWith("image/")
    }

    /** A file to open in another app. */
    data class Opened(
        val path: String,
        val mime: String,
        val name: String?,
    )

    /**
     * The photos and files sent in the conversation, for its information screen (0055), newest first;
     * read once that screen asks for them, then again on every event for the conversation.
     */
    data class Shared(
        val items: List<Item> = emptyList(),
        val loaded: Boolean = false,
        /** There may be older ones than the last here. */
        val more: Boolean = true,
    )

    data class State(
        val conversation: Conversation? = null,
        /** Oldest first, the unsent ones last. */
        val items: List<Item> = emptyList(),
        val loaded: Boolean = false,
        /** There may be items before the first one here. */
        val older: Boolean = true,
        val typing: Boolean = false,
        val draft: String = "",
        val mode: Mode = Mode.New,
        val media: Map<ULong, Media> = emptyMap(),
        val attachment: Pending? = null,
        /** Null until the information screen asks for them. */
        val shared: Shared? = null,
        val problem: Problem? = null,
    ) {
        /**
         * The composer's one action (0043): attach while a new message's
         * field is empty and nothing waits above it (0048), send once it has
         * text or an attachment. Replying or editing never attaches, so send
         * stays there.
         */
        val action: ComposerAction
            get() =
                if (mode == Mode.New && draft.isBlank() && attachment == null) {
                    ComposerAction.ATTACH
                } else {
                    ComposerAction.SEND
                }

        /** Send has something to send. */
        val sendable: Boolean
            get() = draft.isNotBlank() || (mode == Mode.New && attachment != null)
    }

    enum class ComposerAction { ATTACH, SEND }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _opened = MutableSharedFlow<Opened>(extraBufferCapacity = 1)

    /** Files fetched for opening; the activity hands each to another app. */
    val opened: SharedFlow<Opened> = _opened.asSharedFlow()

    // A burst of events reads the timeline once.
    private val reads = Channel<Unit>(Channel.CONFLATED)
    private var failed: (() -> Unit)? = null
    private var marked: ULong? = null

    // Typing frames go one at a time and in order. A key never cancels one:
    // the core counts a frame toward its throttle when it makes it, so a
    // frame lost on the way leaves nothing sent for 3 s.
    private val frames = Channel<Boolean>(Channel.UNLIMITED)
    private var typingStarted = false
    private var typingIdle: Job? = null
    private var typingShown: Job? = null
    private var expiry: Job? = null
    private var loadingOlder = false
    private var loadingShared = false

    init {
        viewModelScope.launch { for (unit in reads) read() }
        viewModelScope.launch { for (active in frames) typingFrame(active) }
        viewModelScope.launch {
            live.events.collect { event ->
                when {
                    event is Event.Typing -> if (event.conversation == id) typing(event.active)
                    event.concerns(id) -> load()
                }
            }
        }
        load()
    }

    fun load() {
        reads.trySend(Unit)
    }

    /** The page before the first item here; does nothing while one is read. */
    fun loadOlder() {
        val first =
            _state.value.items
                .firstOrNull()
                ?.seq ?: return
        if (!_state.value.older || loadingOlder) return
        loadingOlder = true
        viewModelScope.launch {
            try {
                val page = withContext(io) { account.timeline(id, first, PAGE) }
                _state.update { it.copy(items = page + it.items, older = page.size == PAGE.toInt()) }
            } catch (e: CoreException) {
                _state.update { it.copy(problem = e.problem()) }
            } finally {
                loadingOlder = false
            }
        }
    }

    /** Reads the photos and files for the information screen (0055); after that, every read includes them. */
    fun loadShared() {
        if (_state.value.shared == null) _state.update { it.copy(shared = Shared()) }
        load()
    }

    /** The page of photos and files older than the last one here; does nothing while one is read. */
    fun moreShared() {
        val last =
            _state.value.shared
                ?.takeIf { it.more }
                ?.items
                ?.lastOrNull()
                ?.seq
        if (last == null || loadingShared) return
        loadingShared = true
        viewModelScope.launch {
            try {
                val page = withContext(io) { account.shared(id, last, PAGE) }
                val more = page.size == PAGE.toInt()
                _state.update { it.copy(shared = it.shared?.run { copy(items = items + page, more = more) }) }
            } catch (e: CoreException) {
                _state.update { it.copy(problem = e.problem()) }
            } finally {
                loadingShared = false
            }
        }
    }

    fun draft(text: String) {
        _state.update { it.copy(draft = text) }
        if (text.isBlank()) stopTyping() else startTyping()
    }

    /** A reply or an edit carries no photo or file, so one waiting goes (0048). */
    fun reply(item: Item) {
        removeAttachment()
        _state.update { it.copy(mode = Mode.Reply(item)) }
    }

    fun edit(item: Item) {
        val text = (item.content as? Content.Text)?.text ?: return
        removeAttachment()
        _state.update { it.copy(mode = Mode.Edit(item), draft = text) }
    }

    /** Back to a new message; an edit's text goes with it. */
    fun cancelMode() {
        _state.update { it.copy(mode = Mode.New, draft = if (it.mode is Mode.Edit) "" else it.draft) }
    }

    fun send() {
        val state = _state.value
        val text = state.draft.trim()
        if (state.mode == Mode.New && state.attachment != null) {
            _state.update { it.copy(draft = "", attachment = null) }
            stopTyping()
            sendAttachment(state.attachment, text.ifEmpty { null })
            return
        }
        val body =
            when (val mode = state.mode) {
                Mode.New -> Body.Text(text)
                is Mode.Reply -> mode.item.envelopeId?.let { Body.Reply(it, text) }
                is Mode.Edit -> mode.item.envelopeId?.let { Body.Edit(it, text) }
            }
        if (text.isEmpty() || body == null) return
        _state.update { it.copy(draft = "", mode = Mode.New) }
        stopTyping()
        queue(body)
    }

    fun delete(item: Item) {
        queue(Body.Delete(item.envelopeId ?: return))
    }

    /** Adds the emoji, or takes this account's away when it is there. */
    fun react(
        item: Item,
        emoji: String,
    ) {
        val target = item.envelopeId ?: return
        queue(Body.Reaction(target, emoji, remove = item.reactions.any { it.emoji == emoji && it.own }))
    }

    /**
     * Reads a picked photo or file to wait above the field until it is sent
     * or taken away (0048); one over the limit is refused before it is read.
     * A second one takes the place of the first.
     */
    fun pick(picked: Picked) {
        if ((picked.size ?: 0L) > MEDIA_LIMIT) {
            _state.update { it.copy(problem = Problem.TooLarge) }
            return
        }
        perform({ pick(picked) }) {
            val file = picked.read()
            if (file.length() > MEDIA_LIMIT) {
                file.delete()
                _state.update { it.copy(problem = Problem.TooLarge) }
                return@perform
            }
            val pending = Pending(file.path, picked.mime, picked.name)
            _state.getAndUpdate { it.copy(attachment = pending) }.attachment?.let { File(it.path).delete() }
        }
    }

    /** Takes the waiting photo or file away; nothing is sent. */
    fun removeAttachment() {
        _state.getAndUpdate { it.copy(attachment = null) }.attachment?.let { File(it.path).delete() }
    }

    /** Downloads the photo or file of [item], once; a failed one can be asked for again. */
    fun fetch(item: Item) {
        val seq = item.seq ?: return
        if (_state.value.media[seq].let { it is Media.Loading || it is Media.Ready }) return
        viewModelScope.launch { download(seq) }
    }

    /** Fetches the file of [item] and hands it on to be opened. */
    fun open(item: Item) {
        val seq = item.seq ?: return
        val content = item.content as? Content.Media ?: return
        viewModelScope.launch {
            val ready = _state.value.media[seq] as? Media.Ready ?: download(seq)
            if (ready is Media.Ready) _opened.emit(Opened(ready.path, content.mime, content.name))
        }
    }

    /** Sets the disappearing timer, or turns it off with null (0022). */
    fun timer(seconds: UInt?) {
        queue(Body.Disappearing(seconds))
    }

    /**
     * Mutes the conversation for [duration] (0042): no push and no notice for it, on every device of the
     * account. A failure is said, so no one believes a mute that did not happen.
     */
    fun mute(duration: MuteFor) {
        perform({ mute(duration) }) {
            account.mute(id, duration)
            load()
        }
    }

    /** Turns the conversation's notifications back on. */
    fun unmute() {
        perform(::unmute) {
            account.unmute(id)
            load()
        }
    }

    /** Blocks the other person of a 1:1 (0024); the conversation ends. */
    fun block() {
        val other =
            _state.value.conversation
                ?.members
                ?.singleOrNull()
                ?.account ?: return
        viewModelScope.launch {
            try {
                live.performAndWait { it.block(other) }
                failed = null
                _state.update { it.copy(problem = null) }
                load()
            } catch (e: CoreException) {
                // Said, not swallowed: the person must not believe a block that did not happen.
                failed = ::block
                _state.update { it.copy(problem = e.problem()) }
            }
        }
    }

    /** Sends the failed items again. */
    fun resend() {
        live.perform { it.retry(id) }
    }

    fun retry() {
        failed?.invoke() ?: load()
    }

    /** The screen went away or to the background: no one is typing here any more. */
    fun paused() {
        stopTyping()
    }

    private fun queue(body: Body) {
        perform({ queue(body) }) {
            account.send(id, body)
            live.sync()
            load()
        }
    }

    /** Sends [pending] with its caption; a failure puts both back to be sent again. */
    private fun sendAttachment(
        pending: Pending,
        caption: String?,
    ) {
        perform(::send) {
            try {
                account.sendMedia(id, pending.path, pending.mime, caption, pending.name)
            } catch (e: CoreException) {
                _state.update {
                    it.copy(attachment = it.attachment ?: pending, draft = it.draft.ifEmpty { caption.orEmpty() })
                }
                throw e
            }
            // The core copied it into its own folder.
            File(pending.path).delete()
            live.sync()
            load()
        }
    }

    override fun onCleared() {
        // A photo or file still waiting goes with the screen; [samtak.spjall.media.Files.clear] takes
        // what a process death left.
        _state.value.attachment?.let { File(it.path).delete() }
    }

    private suspend fun read() {
        val size = maxOf(PAGE.toInt(), _state.value.items.size).toUInt()
        val sharedSize = _state.value.shared?.let { maxOf(PAGE.toInt(), it.items.size).toUInt() }
        try {
            val (conversation, items) =
                withContext(io) {
                    account.conversations().firstOrNull { it.id == id } to account.timeline(id, null, size)
                }
            val shared =
                sharedSize?.let { size ->
                    val page = withContext(io) { account.shared(id, null, size) }
                    Shared(page, loaded = true, more = page.size >= size.toInt())
                }
            failed = null
            _state.update {
                it.copy(
                    conversation = conversation,
                    items = items,
                    loaded = true,
                    older = it.older && items.size >= size.toInt(),
                    shared = shared ?: it.shared,
                    problem = null,
                )
            }
            markRead(items)
            scheduleExpiry(items)
        } catch (e: CoreException) {
            failed = ::load
            _state.update { it.copy(loaded = true, problem = e.problem()) }
        }
    }

    /** The newest item is on screen once the timeline is read, so everything up to it is read. */
    private suspend fun markRead(items: List<Item>) {
        val newest = items.mapNotNull { it.seq }.maxOrNull() ?: return
        if (marked?.let { newest <= it } == true) return
        withContext(io) { account.markRead(id, newest) }
        marked = newest
        live.sync()
    }

    private suspend fun download(seq: ULong): Media {
        _state.update { it.copy(media = it.media + (seq to Media.Loading)) }
        val media =
            try {
                Media.Ready(withContext(io) { account.media(id, seq) })
            } catch (_: CoreException) {
                Media.Failed
            }
        _state.update { it.copy(media = it.media + (seq to media)) }
        return media
    }

    private fun scheduleExpiry(items: List<Item>) {
        expiry?.cancel()
        val due = items.mapNotNull { it.expiresAt }.minOrNull() ?: return
        expiry =
            viewModelScope.launch {
                delay(maxOf(0L, due.toLong() - now()))
                live.perform { it.expire() }
            }
    }

    private fun typing(active: Boolean) {
        typingShown?.cancel()
        _state.update { it.copy(typing = active) }
        // A typing frame that never ends (the other side went away) stops showing.
        if (active) {
            typingShown =
                viewModelScope.launch {
                    delay(TYPING_SHOWN_MS)
                    _state.update { it.copy(typing = false) }
                }
        }
    }

    private fun startTyping() {
        typingIdle?.cancel()
        typingStarted = true
        frames.trySend(true)
        typingIdle =
            viewModelScope.launch {
                delay(TYPING_IDLE_MS)
                stopTyping()
            }
    }

    private fun stopTyping() {
        typingIdle?.cancel()
        if (!typingStarted) return
        typingStarted = false
        frames.trySend(false)
    }

    private suspend fun typingFrame(active: Boolean) {
        try {
            withContext(io) { account.typing(id, active) }?.let { live.send(it) }
        } catch (_: CoreException) {
            // A typing frame that fails to go is not worth a word.
        }
    }

    private fun perform(
        again: () -> Unit,
        action: suspend () -> Unit,
    ) {
        _state.update { it.copy(problem = null) }
        viewModelScope.launch {
            try {
                withContext(io) { action() }
                failed = null
            } catch (e: CoreException) {
                failed = again
                _state.update { it.copy(problem = e.problem()) }
            } catch (_: IOException) {
                // The picked file could not be read.
                failed = again
                _state.update { it.copy(problem = Problem.Generic()) }
            }
        }
    }

    private companion object {
        const val PAGE = 50u

        // A pause this long in the typing sends the frame that ends it.
        const val TYPING_IDLE_MS = 5_000L
    }
}

/**
 * How long an active typing frame shows without another, here and in the list's row: the core sends
 * at most one active frame each 3 s while one types, so a frame that never ends (the other side went
 * away) stops showing.
 */
internal const val TYPING_SHOWN_MS = 6_000L

/** Whether the timeline of [conversation] may look different after this event. */
private fun Event.concerns(conversation: String): Boolean =
    when (this) {
        is Event.Message -> message.conversation == conversation
        is Event.Profiles -> true
        is Event.Typing -> false
        is Event.Membership -> this.conversation == conversation
        is Event.Joined -> this.conversation == conversation
        is Event.Devices -> this.conversation == conversation
        is Event.Removed -> this.conversation == conversation
        is Event.Stale -> this.conversation == conversation
        is Event.Timeline -> this.conversation == conversation
        is Event.Expired -> this.conversation == conversation
    }
