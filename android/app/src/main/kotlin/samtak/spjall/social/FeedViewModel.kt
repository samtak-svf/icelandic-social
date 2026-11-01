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
import samtak.spjall.core.Community
import samtak.spjall.core.CoreException
import samtak.spjall.core.HomePage
import samtak.spjall.core.Post
import samtak.spjall.core.PostTarget
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.ReportTargetKind
import samtak.spjall.core.WallAudience
import samtak.spjall.core.defaultPostTarget

/** What the feed shows in place of its list (the web's `feedPhase`, decision 0116). */
enum class FeedPhase { LOADING, PROBLEM, LIST, EMPTY }

/**
 * The first tab (decision 0116): the posts of the own wall's friends and of the communities, newest first, and the
 * composer that writes to the own wall or a community. The list is read when the tab is first opened, after a
 * post and on a pull to refresh; coming back to the app reads nothing.
 */
@Suppress("TooManyFunctions")
class FeedViewModel(
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val now: () -> Long = System::currentTimeMillis,
    pollRule: PollRule = CorePollRule,
    defaultTarget: () -> PostTarget = ::defaultPostTarget,
) : ViewModel() {
    data class State(
        val posts: List<Post> = emptyList(),
        /** The cursor of the page after the last one held; null once the end was reached. */
        val next: String? = null,
        /** The first page was answered, with posts or without. */
        val loaded: Boolean = false,
        val loading: Boolean = false,
        val refreshing: Boolean = false,
        val publishing: Boolean = false,
        val problem: Problem? = null,
        /** The communities the composer offers: the picker's, which leaves out those this account may not post in. */
        val communities: List<Community> = emptyList(),
        /** Every community this account is in: the headings name a post's community from them, and rights read them. */
        val mine: List<Community> = emptyList(),
        val target: PostTarget,
        val draft: String = "",
        /** The composer's sheet is open. A post sent closes it; a refusal or a dismissal keeps the draft. */
        val composing: Boolean = false,
        val reacting: Set<String> = emptySet(),
        val answering: Set<String> = emptySet(),
        val reported: Set<String> = emptySet(),
    ) {
        /** Nothing held and no cursor left is the only empty feed; while a cursor remains there is more to find. */
        val phase: FeedPhase
            get() =
                when {
                    posts.isNotEmpty() -> FeedPhase.LIST
                    next != null || !loaded -> if (problem != null && !loading) FeedPhase.PROBLEM else FeedPhase.LOADING
                    else -> FeedPhase.EMPTY
                }

        /** Nothing is held while a cursor remains and no call is on its way or failed: ask for the next go. */
        val keepsAsking: Boolean
            get() = phase == FeedPhase.LOADING && next != null && (!loading && problem == null)

        /** The composer offers [target]: the wall always, a community only once it is among the offered. */
        fun offers(target: PostTarget): Boolean =
            target !is PostTarget.Community || communities.any { it.communityId == target.communityId }

        /** The community a card names: none for a wall post, which shows its author alone. */
        fun community(post: Post): Community? =
            if (post.wallOwner == null) mine.firstOrNull { it.communityId == post.communityId } else null

        /**
         * This account may react to and vote on a post: a wall's, or one of a community it is in and may write in
         * (not read-only, not muted). The suspension is the screen's to apply.
         */
        fun writes(
            post: Post,
            now: Long,
        ): Boolean = post.wallOwner != null || community(post)?.writes(now) == true

        /** This account may close the poll on a post: its author, or a moderator of its community, while open. */
        fun canClose(post: Post): Boolean {
            val open = post.poll?.closed == false
            return open && (post.mine || community(post)?.moderates == true)
        }
    }

    private val _state = MutableStateFlow(State(target = defaultTarget()))
    val state: StateFlow<State> = _state.asStateFlow()
    val attachments = PostAttachments(viewModelScope, io, pollRule)

    /** A paging request came while another call was on its way: it is made once that call is done. */
    private var skipped = false

    /** What a failed call repeats. */
    private var retrying: (() -> Unit)? = null

    init {
        load()
        viewModelScope.launch {
            try {
                val (all, offered) = withContext(io) { social.myCommunities() to social.postCommunities() }
                _state.update { it.copy(mine = all, communities = offered) }
            } catch (_: CoreException) {
                // The headings fall back to the author and the picker to the own wall; the feed itself says why.
            }
            // A remembered community no longer on offer: the row names the wall, so the wall is where it goes.
            if (!_state.value.let { it.offers(it.target) }) onTarget(PostTarget.Wall(WallAudience.FRIENDS))
        }
    }

    private val busy: Boolean
        get() = _state.value.let { it.loading || it.publishing }

    /** The first page, replacing what is held. */
    fun load() = fetch(refresh = false)

    /** Pull to refresh: the first page again; a failure keeps the list and says what went wrong. */
    fun refresh() = fetch(refresh = true)

    private fun fetch(refresh: Boolean) {
        if (busy) return
        _state.update { it.copy(loading = true, refreshing = refresh, problem = null) }
        viewModelScope.launch {
            try {
                val (posts, next) = pages(null)
                _state.update {
                    it.copy(posts = posts, next = next, loaded = true, loading = false, refreshing = false)
                }
                finished(ok = true)
            } catch (e: CoreException) {
                retrying = { fetch(refresh) }
                _state.update { it.copy(loading = false, refreshing = false, problem = e.problem()) }
                finished(ok = false)
            }
        }
    }

    /** The end of the list came into view, or the list is empty while a cursor remains: the next, older page. */
    fun more() {
        val before = _state.value.next ?: return
        if (busy) {
            skipped = true
            return
        }
        skipped = false
        _state.update { it.copy(loading = true, problem = null) }
        viewModelScope.launch {
            try {
                val (posts, next) = pages(before)
                _state.update { it.copy(posts = it.posts.followedBy(posts), next = next, loading = false) }
                finished(ok = true)
            } catch (e: CoreException) {
                retrying = ::more
                _state.update { it.copy(loading = false, problem = e.problem()) }
                finished(ok = false)
            }
        }
    }

    /** A call is done: a paging request it made wait goes out now, unless the call failed (no loop on a failure). */
    private fun finished(ok: Boolean) {
        if (ok) retrying = null
        if (skipped && (!ok || _state.value.next == null)) skipped = false
        if (skipped && ok) more()
    }

    /** Clears the problem whatever failed, then repeats the call that can be repeated (a card's own can not). */
    fun retry() {
        _state.update { it.copy(problem = null) }
        retrying?.invoke()
    }

    /**
     * Reads pages from [before] until one holds a post or ends the feed: a `More` page may be empty (the posts of
     * that stretch were all unreadable) and its cursor says there is more. At most [EMPTY_PAGES] empty pages in
     * one go; the cursor then stays, and the screen goes on asking while nothing is held.
     */
    private suspend fun pages(before: String?): Pair<List<Post>, String?> {
        var cursor = before
        repeat(EMPTY_PAGES) {
            val (posts, next) = page(cursor)
            if (posts.isNotEmpty() || next == null) return posts to next
            cursor = next
        }
        return emptyList<Post>() to cursor
    }

    /** One page: its posts and the cursor after it, null at the end. */
    private suspend fun page(cursor: String?): Pair<List<Post>, String?> =
        when (val page = withContext(io) { social.home(cursor, HOME_PAGE) }) {
            is HomePage.End -> page.posts to null
            is HomePage.More -> page.posts to page.next
        }

    // The composer.

    fun openComposer() = _state.update { it.copy(composing = true) }

    fun closeComposer() = _state.update { it.copy(composing = false) }

    fun onDraft(text: String) = _state.update { it.copy(draft = text) }

    /** Another place sends the images again, since an upload belongs to its target. */
    fun onTarget(target: PostTarget) {
        if (target.place() != _state.value.target.place()) attachments.forgetUploads()
        _state.update { it.copy(target = target) }
    }

    private fun PostTarget.place(): String? = (this as? PostTarget.Community)?.communityId

    fun onAudience(audience: WallAudience) = onTarget(PostTarget.Wall(audience))

    fun onAnonymous(anonymous: Boolean) =
        _state.update { s ->
            val now = s.target as? PostTarget.Community ?: return@update s
            s.copy(target = now.copy(anonymous = anonymous))
        }

    /**
     * Uploads each picked image not yet uploaded, writes the draft to the chosen target and puts the post first.
     * A refusal keeps the draft, its images and its poll, and names what failed.
     */
    fun publish() {
        val s = _state.value
        val attached = attachments.state.value
        val ready = attached.postable(s.draft) && s.offers(s.target)
        if (s.publishing || s.loading || !ready) return
        _state.update { it.copy(publishing = true, problem = null) }
        attachments.clearNotice()
        viewModelScope.launch {
            try {
                val post =
                    withContext(io) {
                        val media = attachments.media { social.uploadPostImageFor(s.target, it).mediaId }
                        social.postTo(s.target, s.draft.trim(), media, attached.poll?.let(PollDraft::options))
                    }
                attachments.spent()
                _state.update {
                    it.copy(
                        posts = listOf(post) + it.posts.without(post.postId),
                        draft = "",
                        publishing = false,
                        composing = false,
                    )
                }
                finished(ok = true)
            } catch (e: CoreException) {
                val notice = e.imageNotice()
                if ((e as? CoreException.Refused)?.code == "invalid_media") attachments.forgetUploads()
                notice?.let(attachments::showNotice)
                _state.update { it.copy(publishing = false, problem = if (notice == null) e.problem() else null) }
                retrying = ::publish.takeIf { notice == null }
                finished(ok = false)
            }
        }
    }

    // The cards.

    fun react(
        postId: String,
        emoji: String,
    ) {
        val post = _state.value.posts.firstOrNull { it.postId == postId } ?: return
        if (postId in _state.value.reacting || !_state.value.writes(post, now())) return
        _state.update { it.copy(reacting = it.reacting + postId) }
        viewModelScope.launch {
            try {
                val changed = withContext(io) { social.toggle(post, emoji) }
                _state.update { it.copy(posts = it.posts.replacing(changed), reacting = it.reacting - postId) }
            } catch (e: CoreException) {
                cardFailed(e.problem())
                _state.update { it.copy(reacting = it.reacting - postId) }
            }
        }
    }

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
        busy = postId in _state.value.answering || !mayAnswer(postId),
        begin = { _state.update { it.copy(answering = it.answering + postId, problem = null) } },
        call = call,
    ) { changed, problem ->
        _state.update { s ->
            val done = s.copy(answering = s.answering - postId)
            if (changed != null) done.copy(posts = done.posts.replacing(changed)) else done
        }
        problem?.let(::cardFailed)
    }

    /** The post is held and this account may write on it; a post no longer in the list is not answered. */
    private fun mayAnswer(postId: String): Boolean =
        _state.value.let { s -> s.posts.firstOrNull { it.postId == postId }?.let { s.writes(it, now()) } == true }

    fun deletePost(postId: String) {
        viewModelScope.launch {
            try {
                withContext(io) { social.deletePost(postId) }
                _state.update { it.copy(posts = it.posts.without(postId)) }
            } catch (e: CoreException) {
                cardFailed(e.problem())
            }
        }
    }

    fun report(
        postId: String,
        reason: ReportReason,
        note: String,
    ) {
        viewModelScope.launch {
            try {
                withContext(io) {
                    social.report(ReportTarget(ReportTargetKind.POST, postId), reason, note.trim())
                }
                _state.update { it.copy(reported = it.reported + postId) }
            } catch (e: CoreException) {
                cardFailed(e.problem())
            }
        }
    }

    /** A card's call has nothing to repeat, and what failed before it is not what this problem offers to retry. */
    private fun cardFailed(problem: Problem) {
        retrying = null
        _state.update { it.copy(problem = problem) }
    }

    private companion object {
        /** Posts a page of the feed asks for. */
        const val HOME_PAGE = 30u

        /** Empty `More` pages one call reads before it hands back; the screen asks again while nothing is held. */
        const val EMPTY_PAGES = 8
    }
}
