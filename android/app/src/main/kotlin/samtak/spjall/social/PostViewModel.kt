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
import samtak.spjall.core.Comment
import samtak.spjall.core.CoreException
import samtak.spjall.core.Post
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget
import java.io.File

/**
 * One post and its comments, oldest first, with the box to add one (decision 0063); the post and each comment
 * can be reported, and this account's own deleted. One function per thing [PostActions] offers.
 */
@Suppress("TooManyFunctions")
class PostViewModel(
    private val id: String,
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val now: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    data class State(
        val post: Post? = null,
        /** Oldest first. */
        val comments: List<Comment> = emptyList(),
        /** The cursor of the next, newer page, null on the last. */
        val next: String? = null,
        val loaded: Boolean = false,
        val busy: Boolean = false,
        val loadingMore: Boolean = false,
        /** The comment being written. */
        val draft: String = "",
        /** The image picked for it (0082), as a local copy, at most one. */
        val image: String? = null,
        /** Why the last image picked or sent was not taken, until the next is picked or the comment goes. */
        val imageNotice: CommunityViewModel.ImageNotice? = null,
        val replyingTo: Comment? = null,
        val sending: Boolean = false,
        val writes: Boolean = false,
        val reacting: Boolean = false,
        /** The poll's vote, withdraw or close is on its way. */
        val answering: Boolean = false,
        /** Whether this account moderates the community: it may pin the post. */
        val moderates: Boolean = false,
        /** The post and comments this account reported from here. */
        val reported: Set<String> = emptySet(),
        /** This account: its own post and comments can be deleted, and its name and photo go on the composer. */
        val me: OwnAccount? = null,
        val problem: Problem? = null,
    ) {
        /** Whether there is something to send: text, an image, or both. */
        val sendable: Boolean get() = draft.isNotBlank() || image != null
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private val _deleted = Channel<String>(Channel.BUFFERED)

    /** The post was deleted: back to its community, by id. */
    val deleted: Flow<String> = _deleted.receiveAsFlow()

    private var failed: (() -> Unit)? = null

    /** The media id of the picked image once uploaded, by its local copy, so a retry does not send it again. */
    private var uploaded: Pair<String, String>? = null

    init {
        load()
    }

    fun load() {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                val post = withContext(io) { social.post(id) }
                // A removed post is all its reader gets: it has no comments to ask for, and they are refused.
                val tombstone = post.isTombstone()
                val page = if (tombstone) null else withContext(io) { social.comments(id, null, PAGE) }
                val me = _state.value.me ?: withContext(io) { social.me() }
                // A wall post's community id is the wall's, which is no community to ask for (0115).
                val wall = post.wallOwner != null
                val community = if (tombstone || wall) null else withContext(io) { social.community(post.communityId) }
                failed = null
                _state.update {
                    it.copy(
                        post = post,
                        comments = page?.comments.orEmpty(),
                        next = page?.next,
                        me = me,
                        writes = if (wall) !tombstone else community?.writes(now()) == true,
                        moderates = community?.moderates == true,
                        loaded = true,
                        busy = false,
                    )
                }
            } catch (e: CoreException) {
                failed = ::load
                _state.update { it.copy(busy = false, loaded = true, problem = e.problem()) }
            }
        }
    }

    fun draft(text: String) {
        if (text.length <= COMMENT_LIMIT) _state.update { it.copy(draft = text) }
    }

    /** Takes the image picked for the comment, replacing one already there; over the server's limit it is refused. */
    fun pick(picked: Picked) {
        if ((picked.size ?: 0L) > IMAGE_LIMIT) {
            _state.update { it.copy(imageNotice = CommunityViewModel.ImageNotice.TooLarge) }
            return
        }
        _state.update { it.copy(imageNotice = null) }
        viewModelScope.launch {
            try {
                val file = withContext(io) { picked.read() }
                val old = _state.value.image
                _state.update { it.copy(image = file.path) }
                if (old != null) withContext(io) { File(old).delete() }
            } catch (_: java.io.IOException) {
                _state.update { it.copy(imageNotice = CommunityViewModel.ImageNotice.Invalid) }
            }
        }
    }

    /** Takes the picked image out of the comment. */
    fun unpick() {
        val path = _state.value.image ?: return
        _state.update { it.copy(image = null, imageNotice = null) }
        uploaded = null
        viewModelScope.launch { withContext(io) { File(path).delete() } }
    }

    fun onReplyTo(comment: Comment?) {
        _state.update { it.copy(replyingTo = comment) }
    }

    /**
     * Sends the draft. The comment is shown at the end once every page is there, and the post counts it; with
     * pages still to come it is reached by scrolling to them.
     */
    fun send() {
        val state = _state.value
        val body = state.draft.trim()
        val path = state.image
        if (!state.sendable || state.sending || state.post == null) return
        _state.update { it.copy(sending = true, problem = null, imageNotice = null) }
        viewModelScope.launch {
            try {
                val comment =
                    withContext(io) {
                        val media = listOfNotNull(path?.let { upload(state.post.communityId, it) })
                        social.createComment(id, body, state.replyingTo?.commentId, media)
                    }
                failed = null
                if (path != null) withContext(io) { File(path).delete() }
                uploaded = null
                _state.update {
                    it.copy(
                        comments = if (it.next == null) it.comments + comment else it.comments,
                        post = it.post?.let { post -> post.copy(commentCount = post.commentCount + 1uL) },
                        draft = "",
                        image = null,
                        replyingTo = null,
                        sending = false,
                    )
                }
            } catch (e: CoreException) {
                val notice = e.imageNotice()
                // A media id the server no longer knows (over a day old): the next try uploads again.
                if ((e as? CoreException.Refused)?.code == "invalid_media") uploaded = null
                failed = if (notice == null) ::send else null
                _state.update {
                    if (notice == null) {
                        it.copy(sending = false, problem = e.problem())
                    } else {
                        it.copy(sending = false, imageNotice = notice)
                    }
                }
            }
        }
    }

    /** The media id of the picked image, uploaded once however many times the send is tried. */
    private fun upload(
        communityId: String,
        path: String,
    ): String =
        uploaded?.takeIf { it.first == path }?.second
            ?: social.uploadPostImage(communityId, path).mediaId.also { uploaded = path to it }

    fun react(emoji: String) {
        val state = _state.value
        val post = state.post ?: return
        if (state.reacting) return
        _state.update { it.copy(reacting = true, problem = null) }
        viewModelScope.launch {
            try {
                val changed = withContext(io) { social.toggle(post, emoji) }
                _state.update { it.copy(post = changed, reacting = false) }
            } catch (e: CoreException) {
                _state.update { it.copy(reacting = false, problem = e.problem()) }
            }
        }
    }

    /**
     * Likes the comment or takes the like back. The thumb shows at once and goes back if the server refuses.
     */
    fun likeComment(commentId: String) {
        val before = _state.value.comments.firstOrNull { it.commentId == commentId } ?: return
        val after =
            before.copy(
                liked = !before.liked,
                likes =
                    if (before.liked) {
                        before.likes - 1uL
                    } else {
                        before.likes +
                            1uL
                    },
            )
        replace(after)
        viewModelScope.launch {
            try {
                withContext(io) { if (after.liked) social.likeComment(commentId) else social.unlikeComment(commentId) }
            } catch (e: CoreException) {
                replace(before)
                _state.update { it.copy(problem = e.problem()) }
            }
        }
    }

    private fun replace(comment: Comment) {
        _state.update { s ->
            s.copy(
                comments =
                    s.comments.map {
                        if (it.commentId ==
                            comment.commentId
                        ) {
                            comment
                        } else {
                            it
                        }
                    },
            )
        }
    }

    /** Votes for an option of the post's poll, or changes the vote to it. */
    fun vote(optionId: String) = answer { social.votePoll(it, optionId) }

    fun withdrawVote() = answer { social.withdrawVote(it) }

    fun closePoll() = answer { social.closePoll(it) }

    private fun answer(call: (String) -> Post) {
        val postId = _state.value.post?.postId ?: return
        viewModelScope.answerPoll(
            io,
            busy = _state.value.answering,
            begin = { _state.update { it.copy(answering = true, problem = null) } },
            call = { call(postId) },
        ) { changed, problem ->
            _state.update { s ->
                val done = s.copy(answering = false)
                if (changed != null) done.copy(post = changed) else done.copy(problem = problem)
            }
        }
    }

    /** Pins the post to the top of its community, or loosens it. */
    fun pin(pinned: Boolean) {
        val post = _state.value.post ?: return
        viewModelScope.launch {
            try {
                withContext(io) {
                    if (pinned) {
                        social.pinPost(
                            post.communityId,
                            post.postId,
                        )
                    } else {
                        social.unpinPost(post.communityId, post.postId)
                    }
                }
                _state.update { s -> s.copy(post = s.post?.copy(pinned = pinned)) }
            } catch (e: CoreException) {
                _state.update { it.copy(problem = e.problem()) }
            }
        }
    }

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

    /** Deletes this account's own post; [deleted] then takes the screen back to its community. */
    fun deletePost() {
        val post = _state.value.post ?: return
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try {
                withContext(io) { social.deletePost(post.postId) }
                _state.update { it.copy(busy = false) }
                _deleted.send(post.communityId)
            } catch (e: CoreException) {
                _state.update { it.copy(busy = false, problem = e.problem()) }
            }
        }
    }

    /** Deletes this account's own comment; with a [reason] it is another's on this wall, removed by its owner. */
    fun deleteComment(
        commentId: String,
        reason: String? = null,
    ) {
        viewModelScope.launch {
            try {
                withContext(io) {
                    if (reason == null) social.deleteComment(commentId) else social.removeWallComment(commentId, reason)
                }
                _state.update { s ->
                    val left = s.comments.filterNot { it.commentId == commentId }
                    val gone = left.size < s.comments.size
                    s.copy(
                        comments = left,
                        post =
                            s.post?.let { post ->
                                if (gone &&
                                    post.commentCount > 0uL
                                ) {
                                    post.copy(commentCount = post.commentCount - 1uL)
                                } else {
                                    post
                                }
                            },
                    )
                }
            } catch (e: CoreException) {
                _state.update { it.copy(problem = e.problem()) }
            }
        }
    }

    /** The end of the comments came into view: the next, newer page. */
    fun more() {
        val state = _state.value
        val next = state.next ?: return
        if (state.loadingMore || state.busy) return
        _state.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            try {
                val page = withContext(io) { social.comments(id, next, PAGE) }
                _state.update { it.copy(comments = it.comments + page.comments, next = page.next, loadingMore = false) }
            } catch (e: CoreException) {
                failed = ::more
                _state.update { it.copy(loadingMore = false, problem = e.problem()) }
            }
        }
    }

    fun retry() {
        failed?.invoke()
    }
}

/** A page of comments. */
private const val PAGE = 50u
