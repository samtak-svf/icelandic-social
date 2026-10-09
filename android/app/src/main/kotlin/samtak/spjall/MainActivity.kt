package samtak.spjall

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.edit
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
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
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import samtak.spjall.brand.R
import samtak.spjall.conversation.ConversationActions
import samtak.spjall.conversation.ConversationScreen
import samtak.spjall.conversation.ConversationViewModel
import samtak.spjall.conversations.ConversationsActions
import samtak.spjall.conversations.ConversationsScreen
import samtak.spjall.conversations.ConversationsViewModel
import samtak.spjall.core.Item
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
import samtak.spjall.signin.UpdateScreen
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.SpjallTheme
import samtak.spjall.ui.Tab
import samtak.spjall.ui.TabBar
import samtak.spjall.ui.rememberBack

/**
 * The one activity: sign-in, then the two tabs. It has one composable per
 * destination, each tying a view model to its screen, which is why it is long.
 */
@Suppress("TooManyFunctions")
class MainActivity : ComponentActivity() {
    private val graph get() = (application as SpjallApplication).graph

    private val signIn: SignInViewModel by viewModels {
        viewModelFactory { initializer { SignInViewModel(graph.account, createSavedStateHandle()) } }
    }

    /** A conversation a notification asked to open, held until the signed-in screens can. */
    private val opens = Channel<String>(Channel.CONFLATED)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The app has only a light theme: dark icons on its bars, whatever the system's mode.
        val bars = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
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

    /** A tapped notification, an invite link, or Kenni's redirect back to the app's scheme. */
    private fun handle(intent: Intent) {
        if (intent.action == ACTION_OPEN_CONVERSATION) {
            intent.getStringExtra(EXTRA_CONVERSATION)?.let { opens.trySend(it) }
            return
        }
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

    /** The store's page for this app, or its web page where no store app is installed. */
    private fun openStore() {
        val page = "details?id=$packageName"
        try {
            startActivity(Intent(Intent.ACTION_VIEW, "market://$page".toUri()))
        } catch (_: ActivityNotFoundException) {
            startActivity(Intent(Intent.ACTION_VIEW, "https://play.google.com/store/apps/$page".toUri()))
        }
    }

    @Composable
    private fun App() {
        val state by signIn.state.collectAsStateWithLifecycle()
        val min by graph.update.min.collectAsStateWithLifecycle()
        // Below the server's floor nothing else would work (decision 0030).
        if (min != null) {
            UpdateScreen(onUpdate = ::openStore)
            return
        }
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
        LaunchedEffect(list) { signIn.invites.collect { list.openInvite(it.token, it.signedUp) } }
        LaunchedEffect(list) { list.opened.collect { nav.navigate(conversation(it)) } }
        LaunchedEffect(Unit) { opens.receiveAsFlow().collect { nav.navigate(conversation(it)) { popUpTo(LIST) } } }
        AskForNotifications()
        val route =
            nav
                .currentBackStackEntryAsState()
                .value
                ?.destination
                ?.route
        // Each screen pads for the status bar itself, so its cream band can reach the top edge.
        Scaffold(
            contentWindowInsets = WindowInsets(0),
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
                    entry.arguments?.getString("id")?.let { Conversation(it, nav) }
                }
            }
        }
    }

    /** Once per install, after sign-in (decision 0025). Refused, Ég points at the settings. */
    @Composable
    private fun AskForNotifications() {
        val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
        LaunchedEffect(Unit) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return@LaunchedEffect
            val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
            if (prefs.getBoolean(ASKED_NOTIFICATIONS, false)) return@LaunchedEffect
            prefs.edit { putBoolean(ASKED_NOTIFICATIONS, true) }
            ask.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun notificationSettings() {
        startActivity(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName),
        )
    }

    @Composable
    private fun Tabs(
        route: String,
        go: (String) -> Unit,
    ) {
        TabBar(
            listOf(
                Tab(AppIcons.Chat, stringResource(R.string.tab_conversations), route == LIST) { go(LIST) },
                Tab(AppIcons.Person, stringResource(R.string.tab_me), route == ME) { go(ME) },
            ),
        )
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
    private fun Conversation(
        id: String,
        nav: NavController,
    ) {
        val model: ConversationViewModel =
            viewModel(key = "conversation-$id") { ConversationViewModel(id, graph.account, graph.socket) }
        val state by model.state.collectAsStateWithLifecycle()
        LaunchedEffect(id) { graph.push.dismiss(id) }
        val photo =
            rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
                uri?.let { model.attach(graph.files.picked(it)) }
            }
        val file =
            rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
                uri?.let { model.attach(graph.files.picked(it)) }
            }
        LaunchedEffect(model) {
            model.opened.collect { open(it) }
        }
        val pop = rememberBack(nav)
        ConversationScreen(
            state,
            object : ConversationActions {
                override fun back() = pop()

                override fun draft(text: String) = model.draft(text)

                override fun send() = model.send()

                override fun reply(item: Item) = model.reply(item)

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

                override fun fetch(item: Item) = model.fetch(item)

                override fun open(item: Item) = model.open(item)

                override fun timer(seconds: UInt?) = model.timer(seconds)

                override fun block() = model.block()

                override fun retry() = model.retry()

                override fun paused() = model.paused()
            },
        )
    }

    @Composable
    private fun Me(signIns: Int) {
        val me: MeViewModel = viewModel(key = "me-$signIns") { MeViewModel(graph.account) }
        val state by me.state.collectAsStateWithLifecycle()
        val notifications = remember { NotificationManagerCompat.from(this) }
        var notificationsOff by remember { mutableStateOf(false) }
        // A block from a conversation menu changes the list here, and the settings the row opens may change.
        LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
            me.load()
            notificationsOff = !notifications.areNotificationsEnabled()
        }
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

                override fun readMarkers(on: Boolean) = me.readMarkers(on)

                override fun typing(on: Boolean) = me.typing(on)

                override fun unblock(account: String) = me.unblock(account)

                override fun revoke(deviceId: String) = me.revoke(deviceId)

                override fun deleteAccount() = me.deleteAccount()

                override fun retry() = me.retry()

                override fun notificationSettings() = this@MainActivity.notificationSettings()
            },
            notificationsOff = notificationsOff,
        )
    }

    /** Hands a fetched file to another app. */
    private fun open(opened: ConversationViewModel.Opened) {
        try {
            startActivity(graph.files.opener(opened.path, opened.mime, opened.name))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, R.string.file_no_app, Toast.LENGTH_LONG).show()
        }
    }

    companion object {
        /** A notification's tap (push/SystemNotifier.kt), with [EXTRA_CONVERSATION] unless it is the fallback. */
        const val ACTION_OPEN_CONVERSATION = "samtak.spjall.OPEN_CONVERSATION"
        const val EXTRA_CONVERSATION = "conversation"

        private const val LIST = "conversations"
        private const val ME = "me"
        private const val PEOPLE = "people"
        private const val CONVERSATION = "conversation"
        private const val PREFS = "push"
        private const val ASKED_NOTIFICATIONS = "asked_notifications"

        private fun conversation(id: String) = "$CONVERSATION/$id"

        /** A tab keeps one copy of itself on the stack, above the list. */
        private fun NavOptionsBuilder.tab() {
            popUpTo(LIST) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    }
}
