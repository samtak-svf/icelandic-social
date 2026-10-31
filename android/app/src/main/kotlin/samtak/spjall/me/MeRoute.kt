package samtak.spjall.me

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import samtak.spjall.AppGraph
import samtak.spjall.BuildConfig
import samtak.spjall.brand.R
import samtak.spjall.core.coreVersion
import samtak.spjall.frames.LocalFrameSession
import samtak.spjall.social.IMAGES
import samtak.spjall.social.PersonRoute
import samtak.spjall.social.PersonViewModel
import samtak.spjall.social.SocialRoutes
import samtak.spjall.social.WithNotificationLevels
import samtak.spjall.social.WithSocialHost
import samtak.spjall.ui.AppRoutes
import samtak.spjall.ui.notificationsOff
import samtak.spjall.ui.openNotificationSettings
import samtak.spjall.ui.shareLink

/**
 * Ég: the person, the invite link and the settings (decision 0044), in the view model the first launch uses,
 * which [owner] holds. [onSignedOut] is told once the account is gone from this device.
 */
@Composable
internal fun MeRoute(
    signIns: Int,
    nav: NavController,
    graph: AppGraph,
    owner: ViewModelStoreOwner,
    onSignedOut: () -> Unit,
    onBack: (() -> Unit)? = null,
) {
    val context = LocalContext.current
    val me: MeViewModel =
        viewModel(viewModelStoreOwner = owner, key = "me-$signIns") { MeViewModel(graph.account) }
    val state by me.state.collectAsStateWithLifecycle()
    val notificationsOff = notificationsOff()
    // A block from a conversation menu changes the list here, and the settings the row opens may change.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { me.load() }
    LaunchedEffect(state.signedOut) {
        if (state.signedOut) {
            graph.socket.stop()
            onSignedOut()
        }
    }
    val actions =
        object : MeActions {
            override fun newLink() = me.newLink()

            override fun share(link: String) = shareLink(context, link)

            override fun readMarkers(on: Boolean) = me.readMarkers(on)

            override fun typing(on: Boolean) = me.typing(on)

            override fun unblock(account: String) = me.unblock(account)

            override fun revoke(deviceId: String) = me.revoke(deviceId)

            override fun deleteAccount() = me.deleteAccount()

            override fun retry() = me.retry()

            override fun notificationSettings() = openNotificationSettings(context)

            override fun verify() = nav.navigate(AppRoutes.VERIFY)

            override fun linkBrowser() = nav.navigate(AppRoutes.LINK)

            override fun statements() = nav.navigate(SocialRoutes.STATEMENTS)

            override fun friends() = nav.navigate(SocialRoutes.FRIENDS)
        }
    // Read here, not in the screen: the core's version needs the native library, which screenshot tests lack.
    val version =
        stringResource(
            R.string.app_version,
            BuildConfig.VERSION_NAME,
            "${BuildConfig.VERSION_CODE}",
            coreVersion(),
        )
    WithNotificationLevels(graph.social) {
        MeScreen(state, actions, notificationsOff = notificationsOff, version = version, onBack = onBack)
    }
}

/**
 * Ég as the wall (decision 0115): this account's own wall, with a gear that opens [MeRoute]'s settings. The account
 * is the one [MeViewModel] holds, so nothing shows until it has loaded.
 */
@Composable
internal fun OwnWallRoute(
    signIns: Int,
    nav: NavController,
    graph: AppGraph,
    owner: ViewModelStoreOwner,
) {
    val me: MeViewModel =
        viewModel(viewModelStoreOwner = owner, key = "me-$signIns") { MeViewModel(graph.account) }
    val state by me.state.collectAsStateWithLifecycle()
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { me.load() }
    val id = state.me?.accountId ?: return
    val wall: PersonViewModel =
        viewModel(key = "wall-$id") { PersonViewModel(id, graph.social) }
    val frames = LocalFrameSession.current
    // Made small and square off the main thread, in the view model (decision 0039).
    val photo =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            uri?.let { frames.open(me.photoRequest { graph.files.master(it) }) }
        }
    val cover =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            uri?.let { frames.open(wall.coverRequest { graph.files.master(it) }) }
        }
    val images =
        rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(IMAGES)) { uris ->
            wall.attachments.pick(uris.map(graph.files::pickedPhoto))
        }
    val image =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            uri?.let { wall.attachments.pick(listOf(graph.files.pickedPhoto(it))) }
        }
    WithSocialHost(
        graph.social,
        openStatements = { nav.navigate(SocialRoutes.STATEMENTS) },
        openPerson = { nav.navigate(SocialRoutes.person(it)) },
    ) {
        PersonRoute(
            wall,
            nav,
            tab = true,
            settings = { nav.navigate(AppRoutes.SETTINGS) },
            choosePhoto = { photo.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            reframePhoto = { frames.open(me.reframePhotoRequest(graph.files::temp)) },
            removePhoto = me::removePhoto,
            chooseCover = { cover.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            reframeCover = { frames.open(wall.reframeCoverRequest(graph.files::temp)) },
            addImage = {
                if (wall.attachments.roomForImage()) {
                    val request = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                    if (wall.attachments.room() > 1) images.launch(request) else image.launch(request)
                }
            },
        )
    }
}
