package samtak.spjall.social

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import samtak.spjall.core.PostTarget
import samtak.spjall.core.ReportReason
import samtak.spjall.core.WallAudience
import samtak.spjall.media.Files

/** The feed tab (decision 0116), wired to its view model, the image pickers and the screens a card leads to. */
@Composable
internal fun FeedRoute(
    social: Social,
    files: Files,
    nav: NavController,
    sharePost: (String) -> Unit,
) {
    val model: FeedViewModel = viewModel { FeedViewModel(social) }
    val state by model.state.collectAsStateWithLifecycle()
    val attached by model.attachments.state.collectAsStateWithLifecycle()
    // Images for the post: several at once while two or more fit, since the system picker refuses fewer than two.
    val image =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            uri?.let { model.attachments.pick(listOf(files.pickedPhoto(it))) }
        }
    val images =
        rememberLauncherForActivityResult(
            ActivityResultContracts.PickMultipleVisualMedia(maxOf(2, IMAGES - attached.picked.size)),
        ) { uris ->
            model.attachments.pick(uris.map(files::pickedPhoto))
        }
    val actions =
        feedActions(model, nav, sharePost) {
            if (model.attachments.roomForImage()) {
                val request = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                if (model.attachments.room() > 1) images.launch(request) else image.launch(request)
            }
        }
    FeedScreen(state, attached, actions)
}

private fun feedActions(
    model: FeedViewModel,
    nav: NavController,
    sharePost: (String) -> Unit,
    pickImage: () -> Unit,
) = object : FeedActions {
    override fun openPost(postId: String) = nav.navigate(SocialRoutes.post(postId))

    override fun comment(postId: String) = nav.navigate(SocialRoutes.post(postId, focus = true))

    override fun sendToConversation(postId: String) = sharePost(postId)

    override fun react(
        postId: String,
        emoji: String,
    ) = model.react(postId, emoji)

    override fun report(
        postId: String,
        reason: ReportReason,
        note: String,
    ) = model.report(postId, reason, note)

    override fun deletePost(postId: String) = model.deletePost(postId)

    override fun more() = model.more()

    override fun refresh() = model.refresh()

    override fun retry() = model.retry()

    override fun draft(text: String) = model.onDraft(text)

    override fun target(target: PostTarget) = model.onTarget(target)

    override fun audience(audience: WallAudience) = model.onAudience(audience)

    override fun anonymous(anonymous: Boolean) = model.onAnonymous(anonymous)

    override fun publish() = model.publish()

    override fun vote(
        postId: String,
        optionId: String,
    ) = model.vote(postId, optionId)

    override fun withdrawVote(postId: String) = model.withdrawVote(postId)

    override fun closePoll(postId: String) = model.closePoll(postId)

    override fun addImage() = pickImage()

    override fun removeImage(path: String) = model.attachments.unpick(path)

    override fun togglePoll() = model.attachments.togglePoll()

    override fun pollOption(
        index: Int,
        text: String,
    ) = model.attachments.option(index, text)

    override fun addPollOption() = model.attachments.addOption()

    override fun removePollOption(index: Int) = model.attachments.removeOption(index)
}
