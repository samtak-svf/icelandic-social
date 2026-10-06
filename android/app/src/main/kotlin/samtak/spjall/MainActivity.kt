package samtak.spjall

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.launch
import samtak.spjall.core.inviteToken
import samtak.spjall.me.MeActions
import samtak.spjall.me.MeScreen
import samtak.spjall.me.MeViewModel
import samtak.spjall.signin.SignInScreen
import samtak.spjall.signin.SignInViewModel
import samtak.spjall.signin.SignInViewModel.Session
import samtak.spjall.ui.SpjallTheme

class MainActivity : ComponentActivity() {
    private val graph get() = (application as SpjallApplication).graph

    private val signIn: SignInViewModel by viewModels {
        viewModelFactory { initializer { SignInViewModel(graph.account, createSavedStateHandle()) } }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // A recreated activity has handled its intent already.
        if (savedInstanceState == null) handle(intent)
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) { signIn.browser.collect(::openBrowser) }
        }
        setContent { SpjallTheme { App() } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** An invite link, or Kenni's redirect back to the app's scheme. */
    private fun handle(intent: Intent) {
        val uri = intent.data?.takeIf { intent.action == Intent.ACTION_VIEW } ?: return
        val token = inviteToken(uri.toString())
        when {
            token != null -> signIn.openInvite(token)
            uri.scheme == BuildConfig.URL_SCHEME -> signIn.complete(uri.toString())
        }
    }

    private fun openBrowser(url: String) {
        try {
            CustomTabsIntent.Builder().build().launchUrl(this, url.toUri())
        } catch (_: ActivityNotFoundException) {
            // No browser at all: nothing on this device can show Kenni.
            signIn.browserMissing()
        }
    }

    private fun share(link: String) {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link)
        startActivity(Intent.createChooser(send, null))
    }

    @Composable
    private fun App() {
        val state by signIn.state.collectAsStateWithLifecycle()
        when (state.session) {
            Session.Checking -> Unit
            Session.SignedOut -> SignInScreen(state, onSignIn = signIn::signIn, onRetry = signIn::retry)
            Session.SignedIn -> Me(key = "me-${state.signIns}")
        }
    }

    @Composable
    private fun Me(key: String) {
        val me: MeViewModel = viewModel(key = key) { MeViewModel(graph.account) }
        val state by me.state.collectAsStateWithLifecycle()
        LaunchedEffect(state.signedOut) { if (state.signedOut) signIn.signedOut() }
        MeScreen(
            state,
            object : MeActions {
                override fun newLink() = me.newLink()

                override fun share(link: String) = this@MainActivity.share(link)

                override fun revoke(deviceId: String) = me.revoke(deviceId)

                override fun deleteAccount() = me.deleteAccount()

                override fun retry() = me.retry()
            },
        )
    }
}
