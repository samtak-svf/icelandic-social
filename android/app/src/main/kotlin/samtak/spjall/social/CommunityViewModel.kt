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
import samtak.spjall.conversation.Picked
import samtak.spjall.core.Community
import samtak.spjall.core.CoreException
import samtak.spjall.core.Post
import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * One community (decision 0063): its name and audience, joining or leaving it or taking back a request to join,
 * writing a post of text and up to four images (0065) while a member who is not muted, and its posts, newest
 * first, each with its reactions and a way into its comments; this account's own posts can be deleted. Its owner
 * and moderators reach its report queue from here. One function per thing [CommunityActions] offers.
 */
@Suppress("TooManyFunctions")
class CommunityViewModel(
    private val id: String,
    private val social: Social,
    private val now: () -> Long = System::currentTimeMillis,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        val community: Community? = null,
        /** Newest first. */
        val posts: List<Post> = emptyList(),
        /** The cursor of the next, older page, null on the last. */
        val next: String? = null,
        val loaded: Boolean = false,
        /** Joining, leaving or the first load is on its way. */
        val busy: Boolean = false,
        val loadingMore: Boolean = false,
        /** The post being written. */
        val draft: String = "",
        /** The images picked for it, as local copies, in their order. */
        val images: List<String> = emptyList(),
        /** Why the last image picked or sent was not taken, until the next is picked or the post goes. */
        val imageNotice: ImageNotice? = null,
        val publishing: Boolean = false,
        /** This account's id: its own posts can be deleted. */
        val me: String? = null,
        /** The posts whose reaction is on its way. */
        val reacting: Set<String> = emptySet(),
        /** The posts and comments this account reported from here. */
        val reported: Set<String> = emptySet(),
        /** Whether this account may write a post: a member, not muted, in a community that still has an owner. */
        val writes: Boolean = false,
        /** A moderator muted this account here. */
        val muted: Boolean = false,
        val problem: Problem? = null,
    ) {
        /** Whether there is something to post: text, images, or both. */
        val postable: Boolean get() = draft.isNotBlank() || images.isNotEmpty()
    }

    /** Why an image did not go with the post. */
    enum class ImageNotice {
        /** More were picked than the four a post holds. */
        TooMany,

        /** Over the server's 10 MB. */
        TooLarge,

        /** Not an image the server takes. */
        Invalid,
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var failed: (() -> Unit)? = null

    /** The media id of each picked image already uploaded, by its local copy, so a retry does not send it again. */
    private val uploaded = ConcurrentHashMap<String, String>()

    init {
        load()
    }

    /** The community and its first page of posts, asked again each time the screen shows. */
    fun load() {
        perform(::load) {
            reload()
            _state.update { it.copy(loaded = true) }
        }
    }

    /** Joins an open community at once, or asks a private one's moderators; then the community as it is now. */
    fun join() {
        perform(::join) {
            social.joinCommunity(id)
            reload()
        }
    }

    fun leave() {
        perform(::leave) {
            social.leaveCommunity(id)
            reload()
        }
    }

    /** Takes back the request to join that waits; then the community as it is now. */
    fun withdraw() {
        perform(::withdraw) {
            social.withdrawJoinRequest(id)
            reload()
        }
    }

    fun draft(text: String) {
        if (text.length <= POST_LIMIT) _state.update { it.copy(draft = text) }
    }

    /** Whether another image fits in the post; when none does, says so instead of opening the picker. */
    fun roomForImage(): Boolean {
        val room = _state.value.images.size < IMAGES
        if (!room) _state.update { it.copy(imageNotice = ImageNotice.TooMany) }
        return room
    }

    /** How many more images the post takes. */
    fun room(): Int = (IMAGES - _state.value.images.size).coerceAtLeast(0)

    /** Adds the image picked to the post. */
    fun pick(picked: Picked) = pick(listOf(picked))

    /**
     * Adds the images picked to the post, in the order picked, copied one after another off the main thread so
     * they can be shown and sent. Those past the fourth, or over the server's limit, are left out with a notice.
     */
    fun pick(picked: List<Picked>) {
        if (picked.isEmpty() || !roomForImage()) return
        val fits = picked.take(room())
        val taken = fits.filter { (it.size ?: 0L) <= IMAGE_LIMIT }
        val notice =
            when {
                taken.size < fits.size -> ImageNotice.TooLarge
                fits.size < picked.size -> ImageNotice.TooMany
                else -> null
            }
        _state.update { it.copy(imageNotice = notice) }
        if (taken.isEmpty()) return
        viewModelScope.launch {
            for (one in taken) {
                try {
                    val file = withContext(io) { one.read() }
                    if (_state.value.images.size < IMAGES) {
                        _state.update { it.copy(images = it.images + file.path) }
                    } else {
                        withContext(io) { file.delete() }
                    }
                } catch (_: java.io.IOException) {
                    _state.update { it.copy(imageNotice = ImageNotice.Invalid) }
                }
            }
        }
    }

    /** Takes a picked image out of the post. */
    fun unpick(path: String) {
        _state.update { it.copy(images = it.images - path, imageNotice = null) }
        uploaded -= path
        viewModelScope.launch { withContext(io) { File(path).delete() } }
    }

    /**
     * Uploads each picked image not yet uploaded, then posts the draft with them; the post goes to the top of the
     * list and the box empties. An image the server refuses is named, and nothing is posted.
     */
    fun publish() {
        val state = _state.value
        val body = state.draft.trim()
        if (!state.postable || state.publishing || !state.writes) return
        _state.update { it.copy(publishing = true, problem = null, imageNotice = null) }
        viewModelScope.launch {
            try {
                val post =
                    withContext(io) {
                        val media =
                            state.images.map { path ->
                                uploaded.getOrPut(path) { social.uploadPostImage(id, path).mediaId }
                            }
                        social.createPost(id, body, media)
                    }
                failed = null
                withContext(io) { state.images.forEach { File(it).delete() } }
                uploaded.clear()
                _state.update {
                    it.copy(posts = listOf(post) + it.posts, draft = "", images = emptyList(), publishing = false)
                }
            } catch (e: CoreException) {
                val notice = e.imageNotice()
                // A media id the server no longer knows (over a day old): the next try uploads again.
                if ((e as? CoreException.Refused)?.code == "invalid_media") uploaded.clear()
                failed = if (notice == null) ::publish else null
                _state.update {
                    if (notice == null) {
                        it.copy(publishing = false, problem = e.problem())
                    } else {
                        it.copy(publishing = false, imageNotice = notice)
                    }
                }
            }
        }
    }

    /** Deletes this account's own post; it leaves the list. */
    fun delete(postId: String) {
        viewModelScope.launch {
            try {
                withContext(io) { social.deletePost(postId) }
                _state.update { s -> s.copy(posts = s.posts.filterNot { it.postId == postId }) }
            } catch (e: CoreException) {
                _state.update { it.copy(problem = e.problem()) }
            }
        }
    }

    /** Presses [kind] on the post: it becomes this account's reaction, or pressed again is taken back. */
    fun react(
        postId: String,
        kind: ReactionKind,
    ) {
        val post = _state.value.posts.firstOrNull { it.postId == postId } ?: return
        if (postId in _state.value.reacting) return
        _state.update { it.copy(reacting = it.reacting + postId, problem = null) }
        viewModelScope.launch {
            try {
                val changed = withContext(io) { social.toggle(post, kind) }
                _state.update { s ->
                    s.copy(
                        posts =
                            s.posts.map {
                                if (it.postId ==
                                    postId
                                ) {
                                    changed
                                } else {
                                    it
                                }
                            },
                        reacting = s.reacting - postId,
                    )
                }
            } catch (e: CoreException) {
                _state.update { it.copy(reacting = it.reacting - postId, problem = e.problem()) }
            }
        }
    }

    /** Reports a post to the community's moderators; once sent, the post shows that it was. */
    fun report(
        target: ReportTarget,
        reason: ReportReason,
        note: String,
    ) {
        viewModelScope.launch {
            try {
                withContext(io) { social.report(target, reason, note.trim()) }
                _state.update { it.copy(reported = it.reported + target.id) }
            } catch (e: CoreException) {
                _state.update { it.copy(problem = e.problem()) }
            }
        }
    }

    /** The end of the list came into view: the next, older page. */
    fun more() {
        val state = _state.value
        val next = state.next ?: return
        if (state.loadingMore || state.busy) return
        _state.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            try {
                val page = withContext(io) { social.communityPosts(id, next, PAGE) }
                _state.update { it.copy(posts = it.posts + page.posts, next = page.next, loadingMore = false) }
            } catch (e: CoreException) {
                failed = ::more
                _state.update { it.copy(loadingMore = false, problem = e.problem()) }
            }
        }
    }

    fun retry() {
        failed?.invoke()
    }

    private fun reload() {
        val community = social.community(id)
        val me = _state.value.me ?: social.me()
        val page = if (community.reads) social.communityPosts(id, null, PAGE) else null
        _state.update {
            it.copy(
                community = community,
                me = me,
                posts = page?.posts.orEmpty(),
                next = page?.next,
                writes = community.writes(now()),
                muted = community.muted(now()),
            )
        }
    }

    private fun perform(
        again: () -> Unit,
        action: () -> Unit,
    ) {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                withContext(io) { action() }
                failed = null
                _state.update { it.copy(busy = false) }
            } catch (e: CoreException) {
                failed = again
                _state.update { it.copy(busy = false, loaded = true, problem = e.problem()) }
            }
        }
    }
}

/** What the server's refusal of an image says, or null when it is not about an image. */
private fun CoreException.imageNotice(): CommunityViewModel.ImageNotice? =
    when ((this as? CoreException.Refused)?.code) {
        "too_large" -> CommunityViewModel.ImageNotice.TooLarge
        "invalid_image" -> CommunityViewModel.ImageNotice.Invalid
        else -> null
    }

/** A page of posts. */
private const val PAGE = 20u

/** The most images one post holds. */
const val IMAGES = 4

/** The largest image the server takes for a post, 10 MB. */
const val IMAGE_LIMIT = 10L * 1024 * 1024
