package samtak.spjall.onboarding

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import samtak.spjall.AppGraph
import samtak.spjall.frames.LocalFrameSession
import samtak.spjall.me.MeViewModel

/**
 * A photo, then notifications; the photo is set as on Ég, by the same view model, which [owner] holds
 * so the tab after the first launch finds it again.
 */
@Composable
internal fun OnboardingRoute(
    signIns: Int,
    onboarding: OnboardingViewModel,
    step: OnboardingViewModel.Step,
    owner: ViewModelStoreOwner,
    graph: AppGraph,
) {
    val me: MeViewModel =
        viewModel(viewModelStoreOwner = owner, key = "me-$signIns") { MeViewModel(graph.account) }
    val state by me.state.collectAsStateWithLifecycle()
    val frames = LocalFrameSession.current
    val photo =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            uri?.let { frames.open(me.photoRequest { graph.files.master(it) }) }
        }
    // Refused, the notice on the list and on Ég points at the system's settings (decision 0025).
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { onboarding.asked() }
    LaunchedEffect(onboarding) {
        onboarding.ask.collect {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ask.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                onboarding.asked()
            }
        }
    }
    OnboardingScreen(
        step,
        state,
        object : OnboardingActions {
            override fun choosePhoto() =
                photo.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))

            override fun photoDone() = onboarding.photoDone()

            override fun enable() = onboarding.enable()

            override fun notNow() = onboarding.notNow()

            override fun retry() = me.retry()
        },
    )
}
