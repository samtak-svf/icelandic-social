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
import samtak.spjall.social.SocialRoutes
import samtak.spjall.social.WithNotificationLevels
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
) {
    val context = LocalContext.current
    val me: MeViewModel =
        viewModel(viewModelStoreOwner = owner, key = "me-$signIns") { MeViewModel(graph.account) }
    val state by me.state.collectAsStateWithLifecycle()
    val notificationsOff = notificationsOff()
    // Made small and square off the main thread, in the view model (decision 0039).
    val frames = LocalFrameSession.current
    val photo =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            uri?.let { frames.open(me.photoRequest { graph.files.master(it) }) }
        }
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

            override fun choosePhoto() =
                photo.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))

            override fun reframePhoto() = frames.open(me.reframePhotoRequest(graph.files::temp))

            override fun removePhoto() = me.removePhoto()

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
        MeScreen(state, actions, notificationsOff = notificationsOff, version = version)
    }
}
