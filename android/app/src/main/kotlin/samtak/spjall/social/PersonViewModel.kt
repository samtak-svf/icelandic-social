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
import samtak.spjall.core.CommunityImage
import samtak.spjall.core.CoreException
import samtak.spjall.core.FrameKind
import samtak.spjall.core.PersonProfile
import samtak.spjall.core.Post
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.ReportTargetKind
import samtak.spjall.core.WallAudience
import samtak.spjall.core.WallProfile
import samtak.spjall.frames.FrameRequest
import samtak.spjall.frames.newImageRequest
import samtak.spjall.frames.storedImageRequest
import java.io.File

/** The tabs of a wall (0115). */
enum class WallTab { POSTS, ABOUT, IMAGES }

/**
 * One account's wall as this one sees it (decisions 0114, 0115): the relation between them and the action each
 * relation has, the snooze, the wall's posts and images, and on this account's own wall the composer, the bio and
 * the cover. The profile is asked for again after each action, so the screen shows what the server holds.
 */
@Suppress("TooManyFunctions")
class PersonViewModel(
    private val accountId: String,
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    data class State(
        val profile: PersonProfile? = null,
        val loaded: Boolean = false,
        val busy: Boolean = false,
        val problem: Problem? = null,
        val wall: WallProfile? = null,
        val tab: WallTab = WallTab.POSTS,
        val posts: List<Post> = emptyList(),
        val postsNext: String? = null,
        val images: List<CommunityImage> = emptyList(),
        val imagesNext: String? = null,
        val imagesLoaded: Boolean = false,
        val draft: String = "",
        val audience: WallAudience = WallAudience.FRIENDS,
        val publishing: Boolean = false,
        /** The images picked for the post being written, as paths of the copies made for it. */
        val picked: List<String> = emptyList(),
        val imageNotice: CommunityViewModel.ImageNotice? = null,
        /** The options of the poll being written, or null when the post is not a poll. */
        val poll: List<String>? = null,
        /** The wall posts a poll call is on its way for. */
        val answering: Set<String> = emptySet(),
        /** The posts reported from this screen. */
        val reportedPosts: Set<String> = emptySet(),
        /** The account was reported from this screen. */
        val reported: Boolean = false,
        /** The account was blocked from this screen: it has nothing more to show. */
        val blocked: Boolean = false,
    ) {
        /** Text, or text with images; a poll needs its text and valid options and takes no images. */
        val postable: Boolean
            get() =
                if (poll != null) {
                    draft.isNotBlank() && PollDraft.valid(poll)
                } else {
                    draft.isNotBlank() || picked.isNotEmpty()
                }
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var failed: (() -> Unit)? = null

    /** The media id each picked image was given once uploaded, so a second try does not upload it again. */
    private val uploaded = java.util.concurrent.ConcurrentHashMap<String, String>()

    init {
        load()
    }

    fun load() {
        perform(::load) {}
    }

    fun add() = perform(::add) { social.sendFriendRequest(accountId) }

    fun cancel() = perform(::cancel) { social.cancelFriendRequest(accountId) }

    fun accept() = perform(::accept) { social.acceptFriendRequest(accountId) }

    fun decline() = perform(::decline) { social.declineFriendRequest(accountId) }

    fun end() = perform(::end) { social.endFriendship(accountId) }

    fun snooze() = perform(::snooze) { social.snoozePerson(accountId) }

    fun unsnooze() = perform(::unsnooze) { social.unsnoozePerson(accountId) }

    fun retry() {
        failed?.invoke()
    }

    /** Blocks the account; the route answers 404 after (0114), so the screen leaves. */
    fun block() {
        viewModelScope.launch {
            attempt { social.blockPerson(accountId) } ?: return@launch
            _state.update { it.copy(blocked = true) }
        }
    }

    /** Reports this account, or one of its wall posts. */
    fun report(
        target: ReportTarget,
        reason: ReportReason,
        note: String,
    ) {
        viewModelScope.launch {
            attempt { social.report(target, reason, note) } ?: return@launch
            _state.update {
                if (target.kind == ReportTargetKind.POST) {
                    it.copy(reportedPosts = it.reportedPosts + target.id)
                } else {
                    it.copy(reported = true)
                }
            }
        }
    }

    fun selectTab(tab: WallTab) {
        _state.update { it.copy(tab = tab) }
        if (tab == WallTab.IMAGES && !_state.value.imagesLoaded) moreImages()
    }

    fun morePosts() {
        val before = _state.value.postsNext ?: return
        viewModelScope.launch {
            val page = attempt { social.wallPosts(accountId, before) } ?: return@launch
            _state.update { it.copy(posts = it.posts + page.posts, postsNext = page.next) }
        }
    }

    fun moreImages() {
        val s = _state.value
        if (s.imagesLoaded && s.imagesNext == null) return
        viewModelScope.launch {
            val page = attempt { social.wallImages(accountId, s.imagesNext) } ?: return@launch
            _state.update { it.copy(images = it.images + page.images, imagesNext = page.next, imagesLoaded = true) }
        }
    }

    fun onDraft(text: String) = _state.update { it.copy(draft = text) }

    fun onAudience(audience: WallAudience) = _state.update { it.copy(audience = audience) }

    /** Whether another image fits in the post; when none does, says so instead of opening the picker. */
    fun roomForImage(): Boolean {
        val room = _state.value.picked.size < IMAGES
        if (!room) _state.update { it.copy(imageNotice = CommunityViewModel.ImageNotice.TooMany) }
        return room
    }

    /** How many more images the post takes. */
    fun room(): Int = (IMAGES - _state.value.picked.size).coerceAtLeast(0)

    /** Adds the images picked to the post, copied off the main thread; a poll takes none. */
    fun pick(picked: List<Picked>) {
        if (picked.isEmpty() || _state.value.poll != null || !roomForImage()) return
        val (taken, notice) = fitting(picked, room())
        _state.update { it.copy(imageNotice = notice) }
        if (taken.isEmpty()) return
        viewModelScope.launch {
            copyPicked(
                taken,
                io,
                have = { _state.value.picked.size },
                add = { path -> _state.update { it.copy(picked = it.picked + path) } },
                failed = { _state.update { it.copy(imageNotice = CommunityViewModel.ImageNotice.Invalid) } },
            )
        }
    }

    fun unpick(path: String) {
        _state.update { it.copy(picked = it.picked - path, imageNotice = null) }
        uploaded -= path
        viewModelScope.launch { withContext(io) { File(path).delete() } }
    }

    fun togglePoll() = _state.update { it.copy(poll = PollDraft.toggled(it.poll, it.picked.isNotEmpty())) }

    fun pollOption(
        index: Int,
        text: String,
    ) = _state.update { s -> s.poll?.let { s.copy(poll = PollDraft.withOption(it, index, text)) } ?: s }

    fun addPollOption() = _state.update { s -> s.poll?.let { s.copy(poll = PollDraft.added(it)) } ?: s }

    fun removePollOption(index: Int) =
        _state.update { s -> s.poll?.let { s.copy(poll = PollDraft.removed(it, index)) } ?: s }

    /**
     * Uploads each picked image not yet uploaded, then writes the draft on this account's own wall with them and
     * the poll, to the chosen audience. A refusal keeps the draft, its images and its poll, and names what failed.
     */
    fun publish() {
        val s = _state.value
        if (s.publishing || !s.postable) return
        _state.update { it.copy(publishing = true, problem = null, imageNotice = null) }
        viewModelScope.launch {
            try {
                val post =
                    withContext(io) {
                        val media =
                            s.picked.map { path -> uploaded.getOrPut(path) { social.uploadWallImage(path).mediaId } }
                        social.createWallPost(s.draft.trim(), media, s.poll?.let(PollDraft::options), s.audience)
                    }
                failed = null
                withContext(io) { s.picked.forEach { File(it).delete() } }
                uploaded.clear()
                _state.update {
                    it.copy(
                        posts = listOf(post) + it.posts,
                        draft = "",
                        picked = emptyList(),
                        poll = null,
                        publishing = false,
                    )
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

    /** Votes for an option of the poll on a wall post, or changes the vote to it. */
    fun vote(
        postId: String,
        optionId: String,
    ) = answer(postId) { social.votePoll(postId, optionId) }

    fun withdrawVote(postId: String) = answer(postId) { social.withdrawVote(postId) }

    fun closePoll(postId: String) = answer(postId) { social.closePoll(postId) }

    private fun answer(
        postId: String,
        call: () -> Post,
    ) = viewModelScope.answerPoll(
        io,
        busy = postId in _state.value.answering,
        begin = { _state.update { it.copy(answering = it.answering + postId, problem = null) } },
        call = call,
    ) { changed, problem ->
        _state.update { s ->
            val done = s.copy(answering = s.answering - postId)
            if (changed != null) {
                done.copy(posts = done.posts.map { if (it.postId == changed.postId) changed else it })
            } else {
                done.copy(problem = problem)
            }
        }
    }

    /** Changes who may read one of this account's wall posts; the card shows the new audience once it holds. */
    fun setAudience(
        postId: String,
        audience: WallAudience,
    ) {
        viewModelScope.launch {
            attempt { social.setPostAudience(postId, audience) } ?: return@launch
            _state.update { s ->
                s.copy(posts = s.posts.map { if (it.postId == postId) it.copy(audience = audience) else it })
            }
        }
    }

    fun deletePost(postId: String) {
        viewModelScope.launch {
            attempt { social.deletePost(postId) } ?: return@launch
            _state.update { s -> s.copy(posts = s.posts.filterNot { it.postId == postId }) }
        }
    }

    fun react(
        postId: String,
        emoji: String,
    ) {
        viewModelScope.launch {
            attempt { social.react(postId, emoji) } ?: return@launch
            val fresh = attempt { social.post(postId) } ?: return@launch
            _state.update { s -> s.copy(posts = s.posts.map { if (it.postId == postId) fresh else it }) }
        }
    }

    /** Sets the bio; blank clears it. */
    fun saveBio(text: String) = changeWall { social.setBio(text.trim()) }

    fun removeCover() = changeWall { social.removeWallCover() }

    /** The request to frame a cover the person has just picked: [read] makes its master. */
    fun coverRequest(read: () -> File): FrameRequest =
        newImageRequest(FrameKind.COVER, read) { file, framing ->
            social.setWallCover(file.path)
            social.setWallCoverFraming(framing)
            _state.update { it.copy(wall = social.wall(accountId)) }
        }

    /** The request to frame the cover again from its stored master; [temp] makes the file it comes down to. */
    fun reframeCoverRequest(temp: () -> File): FrameRequest =
        storedImageRequest(
            FrameKind.COVER,
            { _state.value.wall?.coverFrames },
            { social.wallCoverSource(it) },
            temp,
        ) { framing ->
            social.setWallCoverFraming(framing)
            _state.update { it.copy(wall = social.wall(accountId)) }
        }

    private fun changeWall(change: () -> Unit) {
        viewModelScope.launch {
            attempt { change() } ?: return@launch
            val wall = attempt { social.wall(accountId) } ?: return@launch
            _state.update { it.copy(wall = wall) }
        }
    }

    /** Runs [call] off the main thread; a refusal becomes the screen's problem and the result is null. */
    private suspend fun <T : Any> attempt(call: () -> T): T? =
        try {
            withContext(io) { call() }
        } catch (e: CoreException) {
            _state.update { it.copy(problem = e.problem()) }
            null
        }

    /** Runs [action], if any, then asks for the profile again; a refusal leaves the old profile in view. */
    private fun perform(
        again: () -> Unit,
        action: () -> Unit,
    ) {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                val (profile, wall, page) =
                    withContext(io) {
                        action()
                        Triple(social.person(accountId), social.wall(accountId), social.wallPosts(accountId, null))
                    }
                failed = null
                _state.update {
                    it.copy(
                        profile = profile,
                        wall = wall,
                        posts = page.posts,
                        postsNext = page.next,
                        loaded = true,
                        busy = false,
                    )
                }
            } catch (e: CoreException) {
                failed = again
                _state.update { it.copy(busy = false, loaded = true, problem = e.problem()) }
            }
        }
    }
}
