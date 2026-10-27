package samtak.spjall.social

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import samtak.spjall.account.Account
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.CoreException
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.SocialNotification
import samtak.spjall.frames.LocalFrameSession
import samtak.spjall.media.Files
import samtak.spjall.ui.rememberBack

/**
 * The community screens, kept out of the conversations' graph code: hosted content, its own seam [Social]
 * (decision 0060). [read] is told when the notifications list marks what it shows seen or read; [dismissNotice]
 * takes the system notification of a row away once the row is read or removed.
 */
fun NavGraphBuilder.socialScreens(
    social: Social,
    account: Account,
    files: Files,
    nav: NavController,
    read: () -> Unit,
    sharePost: (String) -> Unit = {},
    dismissNotice: (String) -> Unit = {},
) {
    // Any of these screens can draw a post card, so each is given where the images come from.
    fun screen(
        route: String,
        content: @Composable (NavBackStackEntry) -> Unit,
    ) = composable(route) { entry -> WithPostImages(social) { content(entry) } }

    screen(SocialRoutes.COMMUNITIES) { Communities(social, account, nav, sharePost) }
    screen(SocialRoutes.NOTIFICATIONS) { Notifications(social, nav, read, dismissNotice) }
    screen(SocialRoutes.NEW_COMMUNITY) { NewCommunity(social, files, nav) }
    screen("${SocialRoutes.COMMUNITY}/{id}") { entry ->
        entry.arguments?.getString("id")?.let { CommunityEntry(it, social, files, nav, sharePost) }
    }
    screen(SocialRoutes.POST_PATTERN) { entry ->
        entry.arguments?.getString("id")?.let {
            PostEntry(it, entry.arguments?.getString("focus") == "true", social, files, nav, sharePost)
        }
    }
    screen("${SocialRoutes.REPORTS}/{id}") { entry ->
        entry.arguments?.getString("id")?.let { Reports(it, social, nav) }
    }
    screen("${SocialRoutes.REQUESTS}/{id}") { entry ->
        entry.arguments?.getString("id")?.let { JoinRequests(it, social, nav) }
    }
    screen("${SocialRoutes.ANONYMOUS}/{id}") { entry ->
        entry.arguments?.getString("id")?.let { AnonymousQueue(it, social, nav) }
    }
}

@Composable
private fun Communities(
    social: Social,
    account: Account,
    nav: NavController,
    sharePost: (String) -> Unit,
) {
    val model: CommunitiesViewModel = viewModel { CommunitiesViewModel(social, account) }
    val state by model.state.collectAsStateWithLifecycle()
    // A community joined, left or made elsewhere changes "mine".
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { model.load() }
    CommunitiesScreen(
        state,
        object : CommunitiesActions {
            override fun open(communityId: String) = nav.navigate(SocialRoutes.community(communityId))

            override fun openPost(postId: String) = nav.navigate(SocialRoutes.post(postId))

            override fun comment(postId: String) = nav.navigate(SocialRoutes.post(postId, focus = true))

            override fun sendToConversation(postId: String) = sharePost(postId)

            override fun react(
                postId: String,
                emoji: String,
            ) = model.react(postId, emoji)

            override fun vote(
                postId: String,
                optionId: String,
            ) = model.vote(postId, optionId)

            override fun withdrawVote(postId: String) = model.withdrawVote(postId)

            override fun closePoll(postId: String) = model.closePoll(postId)

            override fun report(
                postId: String,
                reason: ReportReason,
                note: String,
            ) = model.report(postId, reason, note)

            override fun selectTab(tab: CommunitiesTab) = model.selectTab(tab)

            override fun pin(
                communityId: String,
                pinned: Boolean,
            ) = model.pin(communityId, pinned)

            override fun create() = nav.navigate(SocialRoutes.NEW_COMMUNITY)

            override fun search(text: String) = model.search(text)

            override fun more() = model.more()

            override fun moreFeed() = model.moreFeed()

            override fun retry() = model.retry()
        },
    )
}

@Composable
private fun NewCommunity(
    social: Social,
    files: Files,
    nav: NavController,
) {
    val model: CreateCommunityViewModel = viewModel { CreateCommunityViewModel(social) }
    val state by model.state.collectAsStateWithLifecycle()
    val back = rememberBack(nav)
    val frames = LocalFrameSession.current
    val picture =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            uri?.let { frames.open(model.pictureRequest { files.master(it) }) }
        }
    val cover =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            uri?.let { frames.open(model.coverRequest { files.master(it) }) }
        }
    LaunchedEffect(model) {
        model.created.collect { id ->
            nav.navigate(SocialRoutes.community(id)) { popUpTo(SocialRoutes.COMMUNITIES) }
        }
    }
    CreateCommunityScreen(
        state,
        object : CreateCommunityActions {
            override fun name(text: String) = model.name(text)

            override fun description(text: String) = model.description(text)

            override fun audience(audience: CommunityAudience) = model.audience(audience)

            override fun pickPicture() =
                picture.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))

            override fun pickCover() =
                cover.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))

            override fun removePicture() = model.removePicture()

            override fun removeCover() = model.removeCover()

            override fun create() = model.create()

            override fun back() = back()
        },
    )
}

@Composable
private fun CommunityEntry(
    id: String,
    social: Social,
    files: Files,
    nav: NavController,
    sharePost: (String) -> Unit,
) {
    val model: CommunityViewModel = viewModel(key = "community-$id") { CommunityViewModel(id, social) }
    val state by model.state.collectAsStateWithLifecycle()
    val back = rememberBack(nav)
    // Images for the post, through the same picker as a photo in a conversation (decision 0048): several at once
    // while two or more fit, since the system picker refuses a multiple pick of fewer than two, else one.
    val image =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            uri?.let { model.pick(files.pickedPhoto(it)) }
        }
    val images =
        rememberLauncherForActivityResult(
            ActivityResultContracts.PickMultipleVisualMedia(maxOf(2, IMAGES - state.images.size)),
        ) { uris ->
            model.pick(uris.map(files::pickedPhoto))
        }
    // The community's picture and cover (0080): picked, then cut to size off the main thread by the view model.
    val frames = LocalFrameSession.current
    val picture =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            uri?.let { frames.open(model.pictureRequest { files.master(it) }) }
        }
    val cover =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            uri?.let { frames.open(model.coverRequest { files.master(it) }) }
        }
    // The community is gone: back to the list, where it no longer is.
    LaunchedEffect(model) { model.deleted.collect { nav.popBackStack(SocialRoutes.COMMUNITIES, inclusive = false) } }
    // Back from a post: its comment count and reactions may have changed there.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { model.load() }
    CommunityScreen(
        state,
        slots =
            ManageSlots(
                requests = { JoinRequestsPane(id, social) },
                reports = { ReportsPane(id, social) },
                anonymous = { AnonymousQueuePane(id, social) },
            ),
        actions =
            object : CommunityActions {
                override fun back() = back()

                override fun join() = model.join()

                override fun leave() = model.leave()

                override fun open(postId: String) = nav.navigate(SocialRoutes.post(postId))

                override fun comment(postId: String) = nav.navigate(SocialRoutes.post(postId, focus = true))

                override fun pin(
                    postId: String,
                    pinned: Boolean,
                ) = model.pin(postId, pinned)

                override fun sendToConversation(postId: String) = sharePost(postId)

                override fun reports() = nav.navigate(SocialRoutes.reports(id))

                override fun requests() = nav.navigate(SocialRoutes.requests(id))

                override fun anonymousQueue() = nav.navigate(SocialRoutes.anonymous(id))

                override fun selectTab(tab: CommunityTab) = model.selectTab(tab)

                override fun moreGallery() = model.moreGallery()

                override fun togglePoll() = model.togglePoll()

                override fun pollOption(
                    index: Int,
                    text: String,
                ) = model.pollOption(index, text)

                override fun addPollOption() = model.addPollOption()

                override fun removePollOption(index: Int) = model.removePollOption(index)

                override fun setAnonymous(on: Boolean) = model.setAnonymous(on)

                override fun setAnonymousPosts(on: Boolean) = model.setAnonymousPosts(on)

                override fun vote(
                    postId: String,
                    optionId: String,
                ) = model.vote(postId, optionId)

                override fun withdrawVote(postId: String) = model.withdrawVote(postId)

                override fun closePoll(postId: String) = model.closePoll(postId)

                override fun revealAuthor(postId: String) = model.revealAuthor(postId)

                override fun onSearchQuery(query: String) = model.onSearchQuery(query)

                override fun searchPosts() = model.searchPosts()

                override fun loadMembers() = model.loadMembers()

                override fun setCommunityRole(
                    accountId: String,
                    role: CommunityRole,
                ) = model.setCommunityRole(accountId, role)

                override fun updateCommunity(
                    name: String,
                    description: String,
                    audience: CommunityAudience?,
                ) = model.updateCommunity(name, description, audience)

                override fun loadModerationLog() = model.loadModerationLog()

                override fun pickPicture() =
                    picture.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))

                override fun pickCover() =
                    cover.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))

                override fun reframePicture() = frames.open(model.reframePictureRequest(files::temp))

                override fun reframeCover() = frames.open(model.reframeCoverRequest(files::temp))

                override fun removePicture() = model.removePicture()

                override fun removeCover() = model.removeCover()

                override fun deleteCommunity() = model.deleteCommunity()

                override fun draft(text: String) = model.draft(text)

                override fun publish() = model.publish()

                override fun withdraw() = model.withdraw()

                override fun addImage() {
                    if (!model.roomForImage()) return
                    val request = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                    if (model.room() > 1) images.launch(request) else image.launch(request)
                }

                override fun removeImage(path: String) = model.unpick(path)

                override fun delete(postId: String) = model.delete(postId)

                override fun react(
                    postId: String,
                    emoji: String,
                ) = model.react(postId, emoji)

                override fun report(
                    target: ReportTarget,
                    reason: ReportReason,
                    note: String,
                ) = model.report(target, reason, note)

                override fun more() = model.more()

                override fun retry() = model.retry()
            },
    )
}

/** Provides where a post's images come from to [content]; one the core cannot fetch now shows as a plain box. */
@Composable
internal fun WithPostImages(
    social: Social,
    content: @Composable () -> Unit,
) {
    val images =
        remember(social) {
            PostImages { postId, mediaId ->
                try {
                    social.postImage(postId, mediaId)
                } catch (_: CoreException) {
                    null
                }
            }
        }
    CompositionLocalProvider(LocalPostImages provides images, content = content)
}

/**
 * Leaves the post on top of the back stack for its community. Back when the post was opened from that community;
 * otherwise (a link, a notification) into it in place of the post, so the community's own back never returns to the
 * post. A copy of the community already on top is left alone, so it is never stacked twice.
 */
internal fun NavController.leavePostForCommunity(communityId: String) {
    fun isThisCommunity(entry: NavBackStackEntry?) =
        entry?.destination?.route == "${SocialRoutes.COMMUNITY}/{id}" &&
            entry.arguments?.getString("id") == communityId
    when {
        // A second tap while the post is leaving finds the community already on top.
        isThisCommunity(currentBackStackEntry) -> Unit
        isThisCommunity(previousBackStackEntry) -> popBackStack()
        else ->
            navigate(SocialRoutes.community(communityId)) {
                popUpTo(SocialRoutes.POST_PATTERN) { inclusive = true }
            }
    }
}

@Composable
private fun PostEntry(
    id: String,
    focusComment: Boolean,
    social: Social,
    files: Files,
    nav: NavController,
    sharePost: (String) -> Unit,
) {
    val model: PostViewModel = viewModel(key = "post-$id") { PostViewModel(id, social) }
    val state by model.state.collectAsStateWithLifecycle()
    // The comment's one image (0082), through the same picker as a post's.
    val image =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            uri?.let { model.pick(files.pickedPhoto(it)) }
        }
    LaunchedEffect(model) { model.deleted.collect { nav.leavePostForCommunity(it) } }
    PostScreen(
        state,
        focusComment = focusComment,
        actions =
            object : PostActions {
                override fun community(communityId: String) = nav.leavePostForCommunity(communityId)

                override fun vote(optionId: String) = model.vote(optionId)

                override fun withdrawVote() = model.withdrawVote()

                override fun closePoll() = model.closePoll()

                override fun deletePost() = model.deletePost()

                override fun deleteComment(commentId: String) = model.deleteComment(commentId)

                override fun draft(text: String) = model.draft(text)

                override fun send() = model.send()

                override fun addImage() =
                    image.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))

                override fun removeImage() = model.unpick()

                override fun onReplyTo(comment: samtak.spjall.core.Comment?) = model.onReplyTo(comment)

                override fun react(emoji: String) = model.react(emoji)

                override fun likeComment(commentId: String) = model.likeComment(commentId)

                override fun pin(pinned: Boolean) = model.pin(pinned)

                override fun sendToConversation(postId: String) = sharePost(postId)

                override fun report(
                    target: ReportTarget,
                    reason: ReportReason,
                    note: String,
                ) = model.report(target, reason, note)

                override fun more() = model.more()

                override fun retry() = model.retry()
            },
    )
}

@Composable
private fun Notifications(
    social: Social,
    nav: NavController,
    read: () -> Unit,
    dismiss: (String) -> Unit,
) {
    val model: NotificationsViewModel = viewModel { NotificationsViewModel(social, read, dismiss = dismiss) }
    val state by model.state.collectAsStateWithLifecycle()
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { model.load() }
    NotificationsScreen(
        state,
        object : NotificationsActions {
            override fun open(notification: SocialNotification) {
                model.opened(notification)
                when (val opens = notification.opens()) {
                    is Opens.Post -> nav.navigate(SocialRoutes.post(opens.postId))
                    is Opens.Community -> nav.navigate(SocialRoutes.community(opens.communityId))
                }
            }

            override fun more() = model.more()

            override fun retry() = model.retry()

            override fun markAllRead() = model.markAllRead()

            override fun setRead(
                notification: SocialNotification,
                read: Boolean,
            ) = model.setRead(notification, read)

            override fun remove(notification: SocialNotification) = model.remove(notification)

            override fun kindInApp(notification: SocialNotification) = model.kindInApp(notification)

            override fun communityOff(notification: SocialNotification) = model.communityOff(notification)
        },
    )
}
