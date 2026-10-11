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
import samtak.spjall.core.Post
import samtak.spjall.core.SharedPost
import samtak.spjall.socket.Live
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

    /** A Fljótið post shared here, as its card shows it; held for the screen only (decision 0040). */
    sealed interface Shared {
        data object Loading : Shared

        data class Found(
            val post: Post,
        ) : Shared

        /** Deleted, its author's account deleted, or its author blocked: the card does not say which. */
        data object Gone : Shared

        data object Failed : Shared
    }

    /** A file to open in another app. */
    data class Opened(
        val path: String,
        val mime: String,
        val name: String?,
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
        /** Shared posts by id, fetched when their card is on screen. */
        val posts: Map<String, Shared> = emptyMap(),
        val problem: Problem? = null,
    ) {
        /**
         * The composer's one action (0043): attach while a new message's
         * field is empty, send once it has text. Replying or editing never
         * attaches, so send stays there.
         */
        val action: ComposerAction
            get() = if (mode == Mode.New && draft.isBlank()) ComposerAction.ATTACH else ComposerAction.SEND
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

    fun draft(text: String) {
        _state.update { it.copy(draft = text) }
        if (text.isBlank()) stopTyping() else startTyping()
    }

    fun reply(item: Item) {
        _state.update { it.copy(mode = Mode.Reply(item)) }
    }

    fun edit(item: Item) {
        val text = (item.content as? Content.Text)?.text ?: return
        _state.update { it.copy(mode = Mode.Edit(item), draft = text) }
    }

    /** Back to a new message; an edit's text goes with it. */
    fun cancelMode() {
        _state.update { it.copy(mode = Mode.New, draft = if (it.mode is Mode.Edit) "" else it.draft) }
    }

    fun send() {
        val state = _state.value
        val text = state.draft.trim()
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

    /** Sends a photo or file; one over the limit is refused before it is read. */
    fun attach(picked: Picked) {
        if ((picked.size ?: 0L) > MEDIA_LIMIT) {
            _state.update { it.copy(problem = Problem.TooLarge) }
            return
        }
        perform({ attach(picked) }) {
            val file = picked.read()
            try {
                if (file.length() > MEDIA_LIMIT) {
                    _state.update { it.copy(problem = Problem.TooLarge) }
                } else {
                    account.sendMedia(id, file.path, picked.mime, null, picked.name)
                    live.sync()
                    load()
                }
            } finally {
                // The core copied it into its own folder.
                file.delete()
            }
        }
    }

    /** Downloads the photo or file of [item], once; a failed one can be asked for again. */
    fun fetch(item: Item) {
        val seq = item.seq ?: return
        if (_state.value.media[seq].let { it is Media.Loading || it is Media.Ready }) return
        viewModelScope.launch { download(seq) }
    }

    /** Fetches the shared post [postId] for its card, once; a failed one can be asked for again. */
    fun showPost(postId: String) {
        if (_state.value.posts[postId].let { it != null && it != Shared.Failed }) return
        _state.update { it.copy(posts = it.posts + (postId to Shared.Loading)) }
        viewModelScope.launch {
            val shared =
                try {
                    when (val found = withContext(io) { account.sharedPost(postId) }) {
                        is SharedPost.Found -> Shared.Found(found.post)
                        SharedPost.Gone -> Shared.Gone
                    }
                } catch (_: CoreException) {
                    Shared.Failed
                }
            _state.update { it.copy(posts = it.posts + (postId to shared)) }
        }
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

    private suspend fun read() {
        val size = maxOf(PAGE.toInt(), _state.value.items.size).toUInt()
        try {
            val (conversation, items) =
                withContext(io) {
                    account.conversations().firstOrNull { it.id == id } to account.timeline(id, null, size)
                }
            failed = null
            _state.update {
                it.copy(
                    conversation = conversation,
                    items = items,
                    loaded = true,
                    older = it.older && items.size >= size.toInt(),
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
