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
import samtak.spjall.conversation.Picked
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityMember
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.CoreException
import samtak.spjall.core.FrameKind
import samtak.spjall.core.ModerationLogEntry
import samtak.spjall.core.Post
import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget
import samtak.spjall.frames.FrameRequest
import samtak.spjall.frames.newImageRequest
import samtak.spjall.frames.storedImageRequest
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
        val searchQuery: String = "",
        val members: List<CommunityMember> = emptyList(),
        val moderationLog: List<ModerationLogEntry> = emptyList(),
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
        /** This account: its own posts can be deleted, and its name and photo go on the composer row. */
        val me: OwnAccount? = null,
        /** The posts whose reaction is on its way. */
        val reacting: Set<String> = emptySet(),
        /** The posts and comments this account reported from here. */
        val reported: Set<String> = emptySet(),
        /** Whether this account may write a post: a member, not muted, in a community that still has an owner. */
        val writes: Boolean = false,
        /** A moderator muted this account here. */
        val muted: Boolean = false,
        /** Until when (Unix ms) a moderator's decline keeps this account from asking again; null when it may ask. */
        val declinedUntil: ULong? = null,
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

    private val _deleted = Channel<Unit>(Channel.BUFFERED)

    /** The owner deleted the community: back to the list. */
    val deleted: Flow<Unit> = _deleted.receiveAsFlow()

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

    /** Deletes the community (#364, decision 0070); [deleted] then takes the screen back to the list. */
    fun deleteCommunity() {
        perform(::deleteCommunity) {
            social.deleteCommunity(id)
            _deleted.trySend(Unit)
        }
    }

    fun onSearchQuery(query: String) {
        _state.update { it.copy(searchQuery = query) }
    }

    fun searchPosts() {
        val query =
            _state.value.searchQuery
                .trim()
                .ifEmpty { null }
        if (_state.value.busy) return
        _state.update { it.copy(loadingMore = false, busy = true, problem = null) }
        viewModelScope.launch {
            try {
                val page = withContext(io) { social.communityPosts(id, null, PAGE, query) }
                failed = null
                _state.update { it.copy(posts = page.posts, next = page.next, busy = false, loaded = true) }
            } catch (e: CoreException) {
                failed = ::searchPosts
                _state.update { it.copy(busy = false, problem = e.problem()) }
            }
        }
    }

    fun loadMembers() {
        perform(::loadMembers) {
            val members = social.communityMembers(id)
            _state.update { it.copy(members = members) }
        }
    }

    fun setCommunityRole(
        accountId: String,
        role: CommunityRole,
    ) {
        perform({ setCommunityRole(accountId, role) }) {
            social.setCommunityRole(id, accountId, role)
            _state.update { it.copy(members = social.communityMembers(id)) }
        }
    }

    fun updateCommunity(
        name: String,
        description: String,
        audience: CommunityAudience?,
    ) {
        perform({ updateCommunity(name, description, audience) }) {
            val updated = social.updateCommunity(id, name, description, audience)
            _state.update { it.copy(community = updated) }
        }
    }

    /** The crop sheet's request for a picture just picked: the master from [read], then its framing (0080, 0086). */
    fun pictureRequest(read: () -> File): FrameRequest =
        newImageRequest(FrameKind.PHOTO, read) { file, framing ->
            social.setCommunityAvatar(id, file.path)
            social.setCommunityPictureFraming(id, framing)
            refresh()
        }

    /** The crop sheet's request for a cover just picked. */
    fun coverRequest(read: () -> File): FrameRequest =
        newImageRequest(FrameKind.COVER, read) { file, framing ->
            social.setCommunityCover(id, file.path)
            social.setCommunityCoverFraming(id, framing)
            refresh()
        }

    /** The request to frame the picture again from its stored master; [temp] makes the file it comes down to. */
    fun reframePictureRequest(temp: () -> File): FrameRequest =
        storedImageRequest(
            FrameKind.PHOTO,
            { _state.value.community?.photoFrames },
            { social.communityPictureSource(id, it) },
            temp,
        ) { framing ->
            social.setCommunityPictureFraming(id, framing)
            refresh()
        }

    /** The request to frame the cover again from its stored master. */
    fun reframeCoverRequest(temp: () -> File): FrameRequest =
        storedImageRequest(
            FrameKind.COVER,
            { _state.value.community?.coverFrames },
            { social.communityCoverSource(id, it) },
            temp,
        ) { framing ->
            social.setCommunityCoverFraming(id, framing)
            refresh()
        }

    private fun refresh() {
        _state.update { it.copy(community = social.community(id)) }
    }

    fun removePicture() = removeImage(::removePicture, Social::removeCommunityAvatar)

    fun removeCover() = removeImage(::removeCover, Social::removeCommunityCover)

    private fun removeImage(
        again: () -> Unit,
        remove: Social.(String) -> Unit,
    ) {
        perform(again) {
            social.remove(id)
            _state.update { it.copy(community = social.community(id)) }
        }
    }

    fun loadModerationLog() {
        perform(::loadModerationLog) {
            val log = social.communityModerationLog(id, null, MODERATION_LOG_PAGE)
            _state.update { it.copy(moderationLog = log.entries) }
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

    /** Pins the post to the top of the community, or loosens it; the feed is read again so the pinned post leads. */
    fun pin(
        postId: String,
        pinned: Boolean,
    ) {
        perform(again = { pin(postId, pinned) }) {
            if (pinned) social.pinPost(id, postId) else social.unpinPost(id, postId)
            reload()
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
                val query =
                    _state.value.searchQuery
                        .trim()
                        .ifEmpty { null }
                val page = withContext(io) { social.communityPosts(id, next, PAGE, query) }
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
        val query =
            _state.value.searchQuery
                .trim()
                .ifEmpty { null }
        val page = if (community.reads) social.communityPosts(id, null, PAGE, query) else null
        _state.update {
            it.copy(
                community = community,
                me = me,
                posts = page?.posts.orEmpty(),
                next = page?.next,
                writes = community.writes(now()),
                muted = community.muted(now()),
                declinedUntil = community.joinDeclinedUntil?.takeIf { it.toLong() > now() },
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
internal fun CoreException.imageNotice(): CommunityViewModel.ImageNotice? =
    when ((this as? CoreException.Refused)?.code) {
        "too_large" -> CommunityViewModel.ImageNotice.TooLarge
        "invalid_image" -> CommunityViewModel.ImageNotice.Invalid
        else -> null
    }

/** A page of posts. */
private const val PAGE = 20u

/** The first page shown in the community's action log. */
private const val MODERATION_LOG_PAGE = 30u

/** The most images one post holds. */
const val IMAGES = 4

/** The largest image the server takes for a post, 10 MB. */
const val IMAGE_LIMIT = 10L * 1024 * 1024
