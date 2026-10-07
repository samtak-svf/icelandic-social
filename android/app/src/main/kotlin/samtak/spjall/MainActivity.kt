package samtak.spjall

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.NavController
import androidx.navigation.NavOptionsBuilder
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.launch
import samtak.spjall.brand.R
import samtak.spjall.conversation.ConversationScreen
import samtak.spjall.conversations.ConversationsActions
import samtak.spjall.conversations.ConversationsScreen
import samtak.spjall.conversations.ConversationsViewModel
import samtak.spjall.core.inviteToken
import samtak.spjall.me.MeActions
import samtak.spjall.me.MeScreen
import samtak.spjall.me.MeViewModel
import samtak.spjall.people.PeopleActions
import samtak.spjall.people.PeopleScreen
import samtak.spjall.people.PeopleViewModel
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
            // Each sign-in starts over: new view models, and the list as the first screen.
            Session.SignedIn -> key(state.signIns) { Home(state.signIns) }
        }
    }

    /** The two tabs of 1a, Samtöl and Ég, and the screens they lead to. */
    @Composable
    private fun Home(signIns: Int) {
        val nav = rememberNavController()
        val list: ConversationsViewModel =
            viewModel(key = "list-$signIns") { ConversationsViewModel(graph.account, graph.socket) }
        LaunchedEffect(Unit) { graph.socket.start() }
        LaunchedEffect(list) { signIn.invites.collect(list::openInvite) }
        LaunchedEffect(list) { list.opened.collect { nav.navigate(conversation(it)) } }
        val route =
            nav
                .currentBackStackEntryAsState()
                .value
                ?.destination
                ?.route
        Scaffold(
            bottomBar = {
                if (route == LIST || route == ME) Tabs(route) { nav.navigate(it) { tab() } }
            },
        ) { padding ->
            NavHost(
                navController = nav,
                startDestination = LIST,
                modifier = Modifier.padding(padding).consumeWindowInsets(padding),
            ) {
                composable(LIST) { Conversations(list, nav) }
                composable(ME) { Me(signIns) }
                composable(PEOPLE) { People(nav) }
                composable("$CONVERSATION/{id}") { entry ->
                    val id = entry.arguments?.getString("id")
                    val listState by list.state.collectAsStateWithLifecycle()
                    ConversationScreen(listState.conversations.firstOrNull { it.id == id }, onBack = nav::popBackStack)
                }
            }
        }
    }

    @Composable
    private fun Tabs(
        route: String,
        go: (String) -> Unit,
    ) {
        NavigationBar {
            NavigationBarItem(
                selected = route == LIST,
                onClick = { go(LIST) },
                icon = { Icon(Icons.Filled.Email, contentDescription = null) },
                label = { Text(stringResource(R.string.tab_conversations)) },
            )
            NavigationBarItem(
                selected = route == ME,
                onClick = { go(ME) },
                icon = { Icon(Icons.Filled.Person, contentDescription = null) },
                label = { Text(stringResource(R.string.tab_me)) },
            )
        }
    }

    @Composable
    private fun Conversations(
        list: ConversationsViewModel,
        nav: NavController,
    ) {
        val state by list.state.collectAsStateWithLifecycle()
        ConversationsScreen(
            state,
            object : ConversationsActions {
                override fun open(conversation: String) = nav.navigate(conversation(conversation))

                override fun newConversation() = nav.navigate(PEOPLE)

                override fun invite() = nav.navigate(ME) { tab() }

                override fun retry() = list.load()
            },
        )
    }

    @Composable
    private fun People(nav: NavController) {
        val people: PeopleViewModel = viewModel { PeopleViewModel(graph.account, graph.socket) }
        val state by people.state.collectAsStateWithLifecycle()
        LaunchedEffect(people) {
            people.opened.collect { nav.navigate(conversation(it)) { popUpTo(LIST) } }
        }
        PeopleScreen(
            state,
            object : PeopleActions {
                override fun toggle(account: String) = people.toggle(account)

                override fun start() = people.start()

                override fun invite() = nav.navigate(ME) { tab() }

                override fun retry() = people.retry()
            },
        )
    }

    @Composable
    private fun Me(signIns: Int) {
        val me: MeViewModel = viewModel(key = "me-$signIns") { MeViewModel(graph.account) }
        val state by me.state.collectAsStateWithLifecycle()
        LaunchedEffect(state.signedOut) {
            if (state.signedOut) {
                graph.socket.stop()
                signIn.signedOut()
            }
        }
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

    private companion object {
        const val LIST = "conversations"
        const val ME = "me"
        const val PEOPLE = "people"
        const val CONVERSATION = "conversation"

        fun conversation(id: String) = "$CONVERSATION/$id"

        /** A tab keeps one copy of itself on the stack, above the list. */
        fun NavOptionsBuilder.tab() {
            popUpTo(LIST) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    }
}
