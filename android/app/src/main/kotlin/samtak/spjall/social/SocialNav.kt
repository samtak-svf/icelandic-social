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
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import samtak.spjall.account.Account
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CoreException
import samtak.spjall.core.ReactionKind
import samtak.spjall.core.Report
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportState
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.SocialNotification
import samtak.spjall.media.Files
import samtak.spjall.ui.rememberBack

/**
 * The community screens, kept out of the conversations' graph code: hosted content, its own seam [Social]
 * (decision 0060). [read] is told when the notifications list marks what it shows read.
 */
fun NavGraphBuilder.socialScreens(
    social: Social,
    account: Account,
    files: Files,
    nav: NavController,
    read: () -> Unit,
) {
    composable(SocialRoutes.COMMUNITIES) { Communities(social, account, nav) }
    composable(SocialRoutes.NOTIFICATIONS) { Notifications(social, nav, read) }
    composable(SocialRoutes.NEW_COMMUNITY) { NewCommunity(social, nav) }
    composable("${SocialRoutes.COMMUNITY}/{id}") { entry ->
        entry.arguments?.getString("id")?.let { CommunityEntry(it, social, files, nav) }
    }
    composable("${SocialRoutes.POST}/{id}") { entry ->
        entry.arguments?.getString("id")?.let { PostEntry(it, social, nav) }
    }
    composable("${SocialRoutes.REPORTS}/{id}") { entry ->
        entry.arguments?.getString("id")?.let { Reports(it, social, nav) }
    }
}

@Composable
private fun Communities(
    social: Social,
    account: Account,
    nav: NavController,
) {
    val model: CommunitiesViewModel = viewModel { CommunitiesViewModel(social, account) }
    val state by model.state.collectAsStateWithLifecycle()
    // A community joined, left or made elsewhere changes "mine".
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { model.load() }
    CommunitiesScreen(
        state,
        object : CommunitiesActions {
            override fun open(communityId: String) = nav.navigate(SocialRoutes.community(communityId))

            override fun create() = nav.navigate(SocialRoutes.NEW_COMMUNITY)

            override fun search(text: String) = model.search(text)

            override fun more() = model.more()

            override fun retry() = model.retry()
        },
    )
}

@Composable
private fun NewCommunity(
    social: Social,
    nav: NavController,
) {
    val model: CreateCommunityViewModel = viewModel { CreateCommunityViewModel(social) }
    val state by model.state.collectAsStateWithLifecycle()
    val back = rememberBack(nav)
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
) {
    val model: CommunityViewModel = viewModel(key = "community-$id") { CommunityViewModel(id, social) }
    val state by model.state.collectAsStateWithLifecycle()
    val back = rememberBack(nav)
    // An image for the post, through the same picker as a photo in a conversation (decision 0048).
    val image =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            uri?.let { model.pick(files.pickedPhoto(it)) }
        }
    // Back from a post: its comment count and reactions may have changed there.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { model.load() }
    WithPostImages(social) {
        CommunityScreen(
            state,
            object : CommunityActions {
                override fun back() = back()

                override fun join() = model.join()

                override fun leave() = model.leave()

                override fun open(postId: String) = nav.navigate(SocialRoutes.post(postId))

                override fun reports() = nav.navigate(SocialRoutes.reports(id))

                override fun draft(text: String) = model.draft(text)

                override fun publish() = model.publish()

                override fun withdraw() = model.withdraw()

                override fun addImage() {
                    if (model.roomForImage()) {
                        image.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                        )
                    }
                }

                override fun removeImage(path: String) = model.unpick(path)

                override fun delete(postId: String) = model.delete(postId)

                override fun react(
                    postId: String,
                    kind: ReactionKind,
                ) = model.react(postId, kind)

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
}

/** Provides where a post's images come from to [content]; one the core cannot fetch now shows as a plain box. */
@Composable
private fun WithPostImages(
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

@Composable
private fun PostEntry(
    id: String,
    social: Social,
    nav: NavController,
) {
    val model: PostViewModel = viewModel(key = "post-$id") { PostViewModel(id, social) }
    val state by model.state.collectAsStateWithLifecycle()
    // Back when the post was opened from its community, otherwise (a notification) into it, in place of the post.
    val community: (String, Boolean) -> Unit = { communityId, gone ->
        val route = SocialRoutes.community(communityId)
        val previous = nav.previousBackStackEntry
        val fromIt =
            previous?.destination?.route == "${SocialRoutes.COMMUNITY}/{id}" &&
                previous.arguments?.getString("id") == communityId
        when {
            fromIt -> nav.popBackStack()
            gone -> nav.navigate(route) { popUpTo("${SocialRoutes.POST}/{id}") { inclusive = true } }
            else -> nav.navigate(route)
        }
    }
    LaunchedEffect(model) { model.deleted.collect { community(it, true) } }
    WithPostImages(social) {
        PostScreen(
            state,
            object : PostActions {
                override fun community(communityId: String) = community(communityId, false)

                override fun deletePost() = model.deletePost()

                override fun deleteComment(commentId: String) = model.deleteComment(commentId)

                override fun draft(text: String) = model.draft(text)

                override fun send() = model.send()

                override fun react(kind: ReactionKind) = model.react(kind)

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
}

@Composable
private fun Reports(
    communityId: String,
    social: Social,
    nav: NavController,
) {
    val model: ReportsViewModel = viewModel(key = "reports-$communityId") { ReportsViewModel(communityId, social) }
    val state by model.state.collectAsStateWithLifecycle()
    val back = rememberBack(nav)
    ReportsScreen(
        state,
        object : ReportsActions {
            override fun back() = back()

            override fun show(state: ReportState) = model.show(state)

            override fun reason(
                reportId: String,
                text: String,
            ) = model.reason(reportId, text)

            override fun act(
                report: Report,
                verb: ReportsViewModel.Verb,
            ) = model.act(report, verb)

            override fun mute(
                report: Report,
                period: ReportsViewModel.MutePeriod,
            ) = model.act(report, ReportsViewModel.Verb.Mute, period)

            override fun retry() = model.retry()
        },
    )
}

@Composable
private fun Notifications(
    social: Social,
    nav: NavController,
    read: () -> Unit,
) {
    val model: NotificationsViewModel = viewModel { NotificationsViewModel(social, read) }
    val state by model.state.collectAsStateWithLifecycle()
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { model.load() }
    NotificationsScreen(
        state,
        object : NotificationsActions {
            override fun open(notification: SocialNotification) =
                when (val opens = notification.opens()) {
                    is Opens.Post -> nav.navigate(SocialRoutes.post(opens.postId))
                    is Opens.Community -> nav.navigate(SocialRoutes.community(opens.communityId))
                }

            override fun more() = model.more()

            override fun retry() = model.retry()
        },
    )
}
