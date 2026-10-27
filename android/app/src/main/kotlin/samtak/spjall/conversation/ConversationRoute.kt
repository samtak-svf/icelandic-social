package samtak.spjall.conversation

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import samtak.spjall.AppGraph
import samtak.spjall.account.Problem
import samtak.spjall.core.Item
import samtak.spjall.core.MuteFor
import samtak.spjall.social.SocialRoutes
import samtak.spjall.social.WithPostImages
import samtak.spjall.ui.AppRoutes
import samtak.spjall.ui.rememberBack

/** A conversation whose shared posts are drawn from their cards and opened in the community screens (0080). */
@Composable
internal fun ConversationWithPostsRoute(
    id: String,
    nav: NavController,
    graph: AppGraph,
) {
    val cards = remember { PostCards(graph.social) { post -> nav.navigate(SocialRoutes.post(post)) } }
    CompositionLocalProvider(LocalPostCards provides cards) {
        WithPostImages(graph.social) { ConversationRoute(id, nav, graph) }
    }
}

@Composable
private fun ConversationRoute(
    id: String,
    nav: NavController,
    graph: AppGraph,
) {
    val context = LocalContext.current
    val model: ConversationViewModel =
        viewModel(key = "conversation-$id") { ConversationViewModel(id, graph.account, graph.socket, graph.drafts) }
    val state by model.state.collectAsStateWithLifecycle()
    LaunchedEffect(id) { graph.push.dismiss(id) }
    val photo =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            uri?.let { model.pick(graph.files.pickedPhoto(it)) }
        }
    val file =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            uri?.let { model.pick(graph.files.picked(it)) }
        }
    val camera =
        rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { taken ->
            if (taken) graph.files.taken()?.let(model::pick)
        }
    lateinit var shutter: Shutter
    val cameraAsked =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { shutter.answered(it) }
    shutter =
        Shutter(
            allowed = {
                ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                    PackageManager.PERMISSION_GRANTED
            },
            ask = { cameraAsked.launch(Manifest.permission.CAMERA) },
            open = { camera.launch(graph.files.cameraTarget()) },
            denied = { model.denied(Problem.CameraDenied) },
        )
    val locator = remember { Locator(context.applicationContext) }
    val where =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
            if (granted.values.any { it }) model.locate(locator::current) else model.denied(Problem.LocationDenied)
        }
    LaunchedEffect(model) {
        model.opened.collect { openFile(context, graph.files, it) }
    }
    val pop = rememberBack(nav)
    ConversationScreen(
        state,
        object : ConversationActions {
            override fun back() = pop()

            override fun draft(text: String) = model.draft(text)

            override fun send() = model.send()

            override fun reply(item: Item) = model.reply(item)

            override fun forward(item: Item) {
                item.seq?.let { nav.navigate("${AppRoutes.FORWARD}/$id/$it") }
            }

            override fun edit(item: Item) = model.edit(item)

            override fun cancelMode() = model.cancelMode()

            override fun delete(item: Item) = model.delete(item)

            override fun react(
                item: Item,
                emoji: String,
            ) = model.react(item, emoji)

            override fun resend() = model.resend()

            override fun loadOlder() = model.loadOlder()

            override fun attachPhoto() =
                photo.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))

            override fun attachFile() = file.launch(arrayOf("*/*"))

            override fun removeAttachment() = model.removeAttachment()

            // Location is asked for only here, the first time a place is sent (0059).
            override fun attachLocation() =
                if (locator.allowed()) model.locate(locator::current) else where.launch(Locator.PERMISSIONS)

            override fun sendLocation() = model.sendLocation()

            override fun cancelLocation() = model.cancelLocation()

            override fun openPlace(uri: String) {
                // With no map app the card still offers map.is, which a browser opens.
                try {
                    context.startActivity(Intent(Intent.ACTION_VIEW, uri.toUri()))
                } catch (_: ActivityNotFoundException) {
                }
            }

            override fun takePhoto() = shutter.press()

            override fun fetch(item: Item) = model.fetch(item)

            override fun open(item: Item) = model.open(item)

            override fun timer(seconds: UInt?) = model.timer(seconds)

            override fun mute(duration: MuteFor) = model.mute(duration)

            override fun unmute() = model.unmute()

            override fun block() = model.block()

            override fun info() = nav.navigate("${AppRoutes.INFO}/$id")

            override fun retry() = model.retry()

            override fun paused() = model.paused()
        },
    )
}
