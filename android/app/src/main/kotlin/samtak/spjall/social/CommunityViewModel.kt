package samtak.spjall.social

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.account.Problem
import samtak.spjall.account.problem
import samtak.spjall.base.BaseViewModel
import samtak.spjall.base.ScreenState
import samtak.spjall.conversation.Picked
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityImage
import samtak.spjall.core.CommunityMember
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.CoreException
import samtak.spjall.core.FrameKind
import samtak.spjall.core.ModerationLogEntry
import samtak.spjall.core.Post
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget
import samtak.spjall.frames.FrameRequest
import samtak.spjall.frames.newImageRequest
import samtak.spjall.frames.storedImageRequest
import samtak.spjall.ui.fitsIn
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
    pollRule: PollRule = CorePollRule,
) : BaseViewModel<CommunityViewModel.State>(State(pollRule = pollRule), io) {
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
        override val busy: Boolean = false,
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
        /** Why this member has no composer here, as a string resource. */
        val noPostNotice: Int? = null,
        /** Until when (Unix ms) a moderator's decline keeps this account from asking again; null when it may ask. */
        val declinedUntil: ULong? = null,
        override val problem: Problem? = null,
        /** The tab shown (0089). */
        val tab: CommunityTab = CommunityTab.DISCUSSION,
        /** The community's pictures, newest first, for Myndir; [galleryNext] is the cursor of the next page. */
        val gallery: List<CommunityImage> = emptyList(),
        val galleryNext: String? = null,
        val galleryLoaded: Boolean = false,
        val galleryLoading: Boolean = false,
        /** The option fields of the poll being written (0090); null when the post is not a poll. */
        val poll: List<String>? = null,
        /** The post being written goes without the author's name (0091). */
        val anonymous: Boolean = false,
        /** The posts whose poll call (vote, withdraw, close) is on its way. */
        val answering: Set<String> = emptySet(),
        /** The authors a moderator asked to see, by post; an empty name is an account without one (0091). */
        val revealed: Map<String, String> = emptyMap(),
        private val pollRule: PollRule = CorePollRule,
    ) : ScreenState<State> {
        /** The posts a moderator featured, newest pin first. */
        val featured: List<Post> get() = community?.featured.orEmpty()

        /** Whether there is something to post: text, images, or both; a poll needs its text and valid options. */
        val postable: Boolean
            get() = if (poll != null) pollRule.valid(draft, poll) else draft.isNotBlank() || images.isNotEmpty()

        override fun busy(on: Boolean): State = copy(busy = on)

        override fun trouble(problem: Problem?): State = copy(problem = problem)

        override fun answered(): State = copy(loaded = true)
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

    private val _deleted = Channel<Unit>(Channel.BUFFERED)

    /** The owner deleted the community: back to the list. */
    val deleted: Flow<Unit> = _deleted.receiveAsFlow()

    /** The media id of each picked image already uploaded, by its local copy, so a retry does not send it again. */
    private val uploaded = ConcurrentHashMap<String, String>()

    init {
        load()
    }

    /** The community and its first page of posts, asked again each time the screen shows. */
    fun load() {
        perform(::load) {
            reload()
            edit { it.copy(loaded = true) }
        }
    }

    /** Joins an open community at once, or asks a private one's moderators; then the community as it is now. */
    fun join() {
        perform(::join) {
            social.joinCommunity(id)
            reload()
            reloadMembers()
        }
    }

    fun leave() {
        perform(::leave) {
            social.leaveCommunity(id)
            reload()
            reloadMembers()
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
        edit { it.copy(searchQuery = query) }
    }

    fun searchPosts() {
        val query =
            current.searchQuery
                .trim()
                .ifEmpty { null }
        if (current.busy) return
        edit { it.copy(loadingMore = false, busy = true, problem = null) }
        viewModelScope.launch {
            try {
                val page = withContext(io) { social.communityPosts(id, null, PAGE, query) }
                failed = null
                edit { it.copy(posts = page.posts, next = page.next, busy = false, loaded = true) }
            } catch (e: CoreException) {
                failed = ::searchPosts
                edit { it.copy(busy = false, problem = e.problem()) }
            }
        }
    }

    fun loadMembers() {
        perform(::loadMembers) {
            val members = social.communityMembers(id)
            edit { it.copy(members = members) }
        }
    }

    fun setCommunityRole(
        accountId: String,
        role: CommunityRole,
    ) {
        perform({ setCommunityRole(accountId, role) }) {
            social.setCommunityRole(id, accountId, role)
            edit { it.copy(members = social.communityMembers(id)) }
        }
    }

    fun updateCommunity(
        name: String,
        description: String,
        audience: CommunityAudience?,
    ) {
        perform({ updateCommunity(name, description, audience) }) {
            val updated = social.updateCommunity(id, name, description, audience)
            edit { it.copy(community = updated) }
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
            { current.community?.photoFrames },
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
            { current.community?.coverFrames },
            { social.communityCoverSource(id, it) },
            temp,
        ) { framing ->
            social.setCommunityCoverFraming(id, framing)
            refresh()
        }

    private fun refresh() {
        edit { it.copy(community = social.community(id)) }
    }

    fun removePicture() = removeImage(::removePicture, Social::removeCommunityAvatar)

    fun removeCover() = removeImage(::removeCover, Social::removeCommunityCover)

    private fun removeImage(
        again: () -> Unit,
        remove: Social.(String) -> Unit,
    ) {
        perform(again) {
            social.remove(id)
            edit { it.copy(community = social.community(id)) }
        }
    }

    fun loadModerationLog() {
        perform(::loadModerationLog) {
            val log = social.communityModerationLog(id, null, MODERATION_LOG_PAGE)
            edit { it.copy(moderationLog = log.entries) }
        }
    }

    fun draft(text: String) {
        if (text.fitsIn(POST_LIMIT)) edit { it.copy(draft = text) }
    }

    /** Whether another image fits in the post; when none does, says so instead of opening the picker. */
    fun roomForImage(): Boolean {
        val room = current.images.size < IMAGES
        if (!room) edit { it.copy(imageNotice = ImageNotice.TooMany) }
        return room
    }

    /** How many more images the post takes. */
    fun room(): Int = (IMAGES - current.images.size).coerceAtLeast(0)

    /** Adds the image picked to the post. */
    fun pick(picked: Picked) = pick(listOf(picked))

    /**
     * Adds the images picked to the post, in the order picked, copied one after another off the main thread so
     * they can be shown and sent. Those past the fourth, or over the server's limit, are left out with a notice.
     */
    fun pick(picked: List<Picked>) {
        if (picked.isEmpty() || current.poll != null || !roomForImage()) return
        val (taken, notice) = fitting(picked, room())
        edit { it.copy(imageNotice = notice) }
        if (taken.isEmpty()) return
        viewModelScope.launch {
            copyPicked(
                taken,
                io,
                have = { current.images.size },
                add = { path -> edit { it.copy(images = it.images + path) } },
                failed = { edit { it.copy(imageNotice = ImageNotice.Invalid) } },
            )
        }
    }

    /** Takes a picked image out of the post. */
    fun unpick(path: String) {
        edit { it.copy(images = it.images - path, imageNotice = null) }
        uploaded -= path
        viewModelScope.launch { withContext(io) { File(path).delete() } }
    }

    /**
     * Uploads each picked image not yet uploaded, then posts the draft with them; the post goes to the top of the
     * list and the box empties. An image the server refuses is named, and nothing is posted.
     */
    fun publish() {
        val state = current
        val body = state.draft.trim()
        if (!state.postable || state.publishing || !state.writes) return
        edit { it.copy(publishing = true, problem = null, imageNotice = null) }
        viewModelScope.launch {
            try {
                val post =
                    withContext(io) {
                        val media =
                            state.images.map { path ->
                                uploaded.getOrPut(path) { social.uploadPostImage(id, path).mediaId }
                            }
                        val poll = state.poll?.let(PollDraft::options)
                        val anonymous = state.anonymous && state.community?.anonymousPosts == true
                        if (poll == null && !anonymous) {
                            social.createPost(id, body, media)
                        } else {
                            social.createPostWith(id, body, media, anonymous, poll)
                        }
                    }
                failed = null
                withContext(io) { state.images.forEach { File(it).delete() } }
                uploaded.clear()
                edit {
                    it.copy(
                        posts = listOf(post) + it.posts,
                        draft = "",
                        images = emptyList(),
                        poll = null,
                        anonymous = false,
                        publishing = false,
                    )
                }
            } catch (e: CoreException) {
                val notice = e.imageNotice()
                // A media id the server no longer knows (over a day old): the next try uploads again.
                if ((e as? CoreException.Refused)?.code == "invalid_media") uploaded.clear()
                failed = if (notice == null) ::publish else null
                edit {
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
                edit { s -> s.copy(posts = s.posts.without(postId)) }
            } catch (e: CoreException) {
                edit { it.copy(problem = e.problem()) }
            }
        }
    }

    /** Presses [emoji] on the post: it becomes this account's reaction, or pressed again is taken back. */
    fun react(
        postId: String,
        emoji: String,
    ) {
        val post = current.posts.firstOrNull { it.postId == postId } ?: return
        if (postId in current.reacting) return
        edit { it.copy(reacting = it.reacting + postId, problem = null) }
        viewModelScope.launch {
            try {
                val changed = withContext(io) { social.toggle(post, emoji) }
                edit { s ->
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
                edit { it.copy(reacting = it.reacting - postId, problem = e.problem()) }
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

    /** Shows [tab]; Myndir reads its first page and Meðlimir the members when they are first opened. */
    fun selectTab(tab: CommunityTab) {
        edit { it.copy(tab = tab) }
        when (tab) {
            CommunityTab.IMAGES -> if (!current.galleryLoaded) loadGallery()
            CommunityTab.MEMBERS -> if (current.members.isEmpty()) loadMembers()
            else -> Unit
        }
    }

    /** The first page of the community's pictures. */
    fun loadGallery() {
        if (current.galleryLoading) return
        edit { it.copy(galleryLoading = true, problem = null) }
        viewModelScope.launch {
            try {
                val page = withContext(io) { social.communityImages(id, null, GALLERY_PAGE) }
                failed = null
                edit {
                    it.copy(
                        gallery = page.images,
                        galleryNext = page.next,
                        galleryLoaded = true,
                        galleryLoading = false,
                    )
                }
            } catch (e: CoreException) {
                failed = ::loadGallery
                edit { it.copy(galleryLoading = false, problem = e.problem()) }
            }
        }
    }

    /** The end of the grid came into view: the next, older page. */
    fun moreGallery() {
        val state = current
        val next = state.galleryNext ?: return
        if (state.galleryLoading) return
        edit { it.copy(galleryLoading = true) }
        viewModelScope.launch {
            try {
                val page = withContext(io) { social.communityImages(id, next, GALLERY_PAGE) }
                edit {
                    it.copy(gallery = it.gallery + page.images, galleryNext = page.next, galleryLoading = false)
                }
            } catch (e: CoreException) {
                failed = ::moreGallery
                edit { it.copy(galleryLoading = false, problem = e.problem()) }
            }
        }
    }

    /** Turns the post being written into a poll with two empty options, or back into a plain post. */
    fun togglePoll() = edit { it.copy(poll = PollDraft.toggled(it.poll, it.images.isNotEmpty())) }

    fun pollOption(
        index: Int,
        text: String,
    ) = edit { s -> s.poll?.let { s.copy(poll = PollDraft.withOption(it, index, text)) } ?: s }

    fun addPollOption() = edit { s -> s.poll?.let { s.copy(poll = PollDraft.added(it)) } ?: s }

    fun removePollOption(index: Int) = edit { s -> s.poll?.let { s.copy(poll = PollDraft.removed(it, index)) } ?: s }

    fun setAnonymous(on: Boolean) {
        edit { it.copy(anonymous = on) }
    }

    /** Votes for an option of the poll on [postId], or changes the vote to it. */
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
        busy = postId in current.answering,
        begin = { edit { it.copy(answering = it.answering + postId, problem = null) } },
        call = call,
    ) { changed, problem ->
        edit { s ->
            val done = s.copy(answering = s.answering - postId)
            if (changed != null) done.replacing(changed) else done.copy(problem = problem)
        }
    }

    /** Asks for the author of an anonymous post (the log records who asked, 0091). */
    fun revealAuthor(postId: String) {
        viewModelScope.launch {
            try {
                val author = withContext(io) { social.revealAuthor(postId) }
                edit { it.copy(revealed = it.revealed + (postId to author.name.orEmpty())) }
            } catch (e: CoreException) {
                edit { it.copy(problem = e.problem()) }
            }
        }
    }

    /** The owner lets members post without their name, or stops it (0091). */
    fun setAnonymousPosts(on: Boolean) {
        perform({ setAnonymousPosts(on) }) {
            val updated = social.setAnonymousPosts(id, on)
            edit { it.copy(community = updated.copy(featured = it.featured)) }
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
                edit { it.copy(reported = it.reported + target.id) }
            } catch (e: CoreException) {
                edit { it.copy(problem = e.problem()) }
            }
        }
    }

    /** The end of the list came into view: the next, older page. */
    fun more() {
        val state = current
        val next = state.next ?: return
        if (state.loadingMore || state.busy) return
        edit { it.copy(loadingMore = true) }
        viewModelScope.launch {
            try {
                val query =
                    current.searchQuery
                        .trim()
                        .ifEmpty { null }
                val page = withContext(io) { social.communityPosts(id, next, PAGE, query) }
                edit { it.copy(posts = it.posts + page.posts, next = page.next, loadingMore = false) }
            } catch (e: CoreException) {
                failed = ::more
                edit { it.copy(loadingMore = false, problem = e.problem()) }
            }
        }
    }

    private fun reload() {
        val community = social.community(id)
        val me = current.me ?: social.me()
        val query =
            current.searchQuery
                .trim()
                .ifEmpty { null }
        val page = if (community.reads) social.communityPosts(id, null, PAGE, query) else null
        edit {
            it.copy(
                community = community,
                me = me,
                posts = page?.posts.orEmpty(),
                next = page?.next,
                writes = community.writes(now()),
                noPostNotice = community.noPostNotice(now()),
                declinedUntil = community.joinDeclinedUntil?.takeIf { it.toLong() > now() },
                tab =
                    if (it.tab == CommunityTab.FEATURED && community.featured.isEmpty()) {
                        CommunityTab.DISCUSSION
                    } else {
                        it.tab
                    },
            )
        }
    }

    /** The member list as the community now allows it; a refused read leaves it empty, never an error. */
    private fun reloadMembers() {
        val readable = current.community?.reads == true
        val members = if (readable) runCatching { social.communityMembers(id) }.getOrNull() else null
        edit { it.copy(members = members.orEmpty()) }
    }
}

/** A page of the community's pictures. */
private const val GALLERY_PAGE = 30u

/** A page of posts. */
private const val PAGE = 20u

/** The first page shown in the community's action log. */
private const val MODERATION_LOG_PAGE = 30u
