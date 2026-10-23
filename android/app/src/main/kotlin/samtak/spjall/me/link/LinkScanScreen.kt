package samtak.spjall.me.link

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import samtak.spjall.brand.R
import samtak.spjall.core.isLinkCode
import samtak.spjall.me.Pill
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.Type
import java.util.concurrent.Executors

/**
 * The first half of linking a browser (decision 0064): the camera looking for the code the browser shows,
 * or a field to paste it into, then the wait while the server is asked. A refused code and a failed call
 * are shown here too, with a way to try another. [isCode] is the camera's test for a frame worth stopping at.
 */
@Composable
fun LinkScanScreen(
    state: LinkViewModel.State,
    actions: LinkActions,
    isCode: (String) -> Boolean = ::isLinkCode,
) {
    LinkFrame(title = R.string.device_link_scan_title, onBack = actions::back) {
        when (state) {
            LinkViewModel.State.Pasting -> Pasting(actions)
            LinkViewModel.State.Inspecting -> Progress()
            is LinkViewModel.State.Refused -> Refused(state.reason, actions)
            is LinkViewModel.State.Failed -> ProblemCard(state.problem, actions::retry)
            else -> Scanning(actions, isCode)
        }
    }
}

/** The cream surface, back button and title both link screens share. */
@Composable
internal fun LinkFrame(
    title: Int,
    onBack: () -> Unit,
    content: @Composable () -> Unit,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.safeDrawingPadding()) {
            IconButton(onClick = onBack, modifier = Modifier.padding(start = 4.dp)) {
                Icon(AppIcons.Back, contentDescription = stringResource(R.string.back), tint = Palette.fg)
            }
            Column(
                modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    text = stringResource(title),
                    style = Type.accountName,
                    modifier = Modifier.semantics { heading() },
                )
                content()
            }
        }
    }
}

@Composable
private fun Scanning(
    actions: LinkActions,
    isCode: (String) -> Boolean,
) {
    val context = LocalContext.current
    var allowed by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED,
        )
    }
    // Asked once, on arriving without it; a refusal leaves the field below as the way on.
    var asked by rememberSaveable { mutableStateOf(false) }
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed = it }
    DisposableEffect(allowed, asked) {
        if (!allowed && !asked) {
            asked = true
            permission.launch(Manifest.permission.CAMERA)
        }
        onDispose {}
    }
    Text(stringResource(R.string.device_link_scan_hint), style = MaterialTheme.typography.bodyLarge)
    if (allowed) {
        CameraView(isCode, actions::submit, Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(16.dp)))
    } else {
        Text(stringResource(R.string.device_link_camera_denied), style = MaterialTheme.typography.bodyMedium)
    }
    TextButton(onClick = actions::paste, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.device_link_paste), color = Palette.fg)
    }
}

/** The back camera's preview, with every frame read for a QR code [accepts] says is wanted. */
@Composable
private fun CameraView(
    accepts: (String) -> Boolean,
    onCode: (String) -> Unit,
    modifier: Modifier,
) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    DisposableEffect(executor) { onDispose { executor.shutdown() } }
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            PreviewView(ctx).also { view ->
                val providerFuture = ProcessCameraProvider.getInstance(ctx)
                providerFuture.addListener({
                    val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
                    val main = ContextCompat.getMainExecutor(ctx)
                    val analyzer = LinkScanAnalyzer(accepts) { text -> main.execute { onCode(text) } }
                    val analysis =
                        ImageAnalysis
                            .Builder()
                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .build()
                            .also { it.setAnalyzer(executor, analyzer) }
                    val provider = providerFuture.get()
                    provider.unbindAll()
                    // A phone without a back camera shows an empty box; the field below still works.
                    runCatching {
                        provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                    }
                }, ContextCompat.getMainExecutor(context))
            }
        },
    )
}

@Composable
private fun Pasting(actions: LinkActions) {
    var text by rememberSaveable { mutableStateOf("") }
    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        label = { Text(stringResource(R.string.device_link_code_field)) },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth(),
    )
    Pill(
        text = stringResource(R.string.device_link_continue),
        filled = true,
        enabled = text.isNotBlank(),
        onClick = { actions.submit(text) },
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun Progress() {
    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

@Composable
private fun Refused(
    reason: LinkViewModel.Reason,
    actions: LinkActions,
) {
    Text(stringResource(reason.text), style = MaterialTheme.typography.bodyLarge)
    Pill(
        text = stringResource(R.string.try_again),
        filled = true,
        onClick = actions::again,
        modifier = Modifier.fillMaxWidth(),
    )
}
