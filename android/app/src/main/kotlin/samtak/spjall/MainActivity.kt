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
import androidx.compose.runtime.CompositionLocalProvider
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
import samtak.spjall.conversations.PickActions
import samtak.spjall.conversations.PickScreen
import samtak.spjall.conversations.PickViewModel
import samtak.spjall.core.Item
import samtak.spjall.core.MuteFor
import samtak.spjall.core.Person
import samtak.spjall.core.Post
import samtak.spjall.core.inviteToken
import samtak.spjall.feed.FeedScreen
import samtak.spjall.feed.PostsActions
import samtak.spjall.feed.PostsViewModel
import samtak.spjall.feed.RepliesActions
import samtak.spjall.feed.RepliesScreen
import samtak.spjall.feed.RepliesViewModel
import samtak.spjall.feed.WallScreen
import samtak.spjall.feed.sharing
import samtak.spjall.me.MeActions
import samtak.spjall.me.MeScreen
import samtak.spjall.me.MeViewModel
import samtak.spjall.me.SettingsScreen
import samtak.spjall.people.PeopleActions
import samtak.spjall.people.PeopleScreen
import samtak.spjall.people.PeopleViewModel
import samtak.spjall.signin.SignInScreen
import samtak.spjall.signin.SignInViewModel
import samtak.spjall.signin.SignInViewModel.Session
import samtak.spjall.signin.UpdateScreen
import samtak.spjall.signin.VerifyScreen
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.LocalPhotos
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

    /** A tapped notification, an invite link, or a provider's redirect back to the app's scheme. */
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
            // No browser at all: nothing on this device can show the provider.
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
            Session.SignedIn ->
                key(state.signIns) {
                    CompositionLocalProvider(LocalPhotos provides graph.photos) { Home(state.signIns) }
                }
        }
    }

    /** The three tabs, Fljótið, Samtöl and Ég (decision 0034), and the screens they lead to. */
    @Composable
    private fun Home(signIns: Int) {
        val nav = rememberNavController()
        val list: ConversationsViewModel =
            viewModel(key = "list-$signIns") { ConversationsViewModel(graph.account, graph.socket) }
        LaunchedEffect(Unit) { graph.socket.start() }
        LaunchedEffect(list) { signIn.invites.collect { list.openInvite(it.token, it.signedUp) } }
        LaunchedEffect(list) { list.opened.collect { nav.navigate(conversation(it)) } }
        // Kenni is offered once after a sign-in, and "Seinna" goes on to Fljótið (decision 0035).
        LaunchedEffect(Unit) { signIn.offers.collect { nav.navigate(VERIFY) } }
        LaunchedEffect(Unit) {
            opens.receiveAsFlow().collect {
                nav.navigate(LIST) { tab() }
                nav.navigate(conversation(it))
            }
        }
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
                if (route in TABS) Tabs(route) { nav.navigate(it) { tab() } }
            },
        ) { padding ->
            NavHost(
                navController = nav,
                startDestination = FEED,
                modifier = Modifier.padding(padding).consumeWindowInsets(padding),
            ) {
                composable(FEED) { Feed(signIns, nav) }
                composable(LIST) { Conversations(list, nav) }
                composable(ME) { Me(signIns, nav, settings = false) }
                composable(SETTINGS) { Me(signIns, nav, settings = true) }
                composable(VERIFY) { Verify(nav) }
                composable(PEOPLE) { People(nav) }
                composable("$WALL/{account}") { entry ->
                    entry.arguments?.getString("account")?.let { Wall(it, nav) }
                }
                composable("$REPLIES/{id}") { entry ->
                    entry.arguments?.getString("id")?.let { Replies(it, nav) }
                }
                composable("$CONVERSATION/{id}") { entry ->
                    entry.arguments?.getString("id")?.let { Conversation(it, nav) }
                }
                composable("$FORWARD/{from}/{seq}") { entry ->
                    val from = entry.arguments?.getString("from")
                    val seq = entry.arguments?.getString("seq")?.toULongOrNull()
                    if (from != null && seq != null) Forward(from, seq, nav)
                }
                composable("$SHARE/{postId}") { entry ->
                    entry.arguments?.getString("postId")?.let { SharePost(it, nav) }
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
        route: String?,
        go: (String) -> Unit,
    ) {
        TabBar(
            listOf(
                Tab(AppIcons.Waves, stringResource(R.string.tab_feed), route == FEED) { go(FEED) },
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
        val notificationsOff = notificationsOff()
        ConversationsScreen(
            state,
            object : ConversationsActions {
                override fun open(conversation: String) = nav.navigate(conversation(conversation))

                override fun newConversation() = nav.navigate(PEOPLE)

                override fun search(text: String) = list.search(text)

                override fun openPerson(account: String) = list.openPerson(account)

                override fun invite() = nav.navigate(ME) { tab() }

                override fun retry() = list.retry()

                override fun notificationSettings() = this@MainActivity.notificationSettings()
            },
            notificationsOff = notificationsOff,
        )
    }

    /** Whether the system blocks the app's notifications, asked again each time the app comes back. */
    @Composable
    private fun notificationsOff(): Boolean {
        val notifications = remember { NotificationManagerCompat.from(this) }
        var off by remember { mutableStateOf(false) }
        LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { off = !notifications.areNotificationsEnabled() }
        return off
    }

    /** Fljótið; read again whenever it shows, since nothing is pushed (decision 0034). */
    @Composable
    private fun Feed(
        signIns: Int,
        nav: NavController,
    ) {
        val feed: PostsViewModel =
            viewModel(viewModelStoreOwner = this, key = "feed-$signIns") {
                PostsViewModel(PostsViewModel.Source.Feed, graph.account)
            }
        val state by feed.state.collectAsStateWithLifecycle()
        LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { feed.refresh() }
        FeedScreen(state, postsActions(feed, state.me, nav), feed.posted)
    }

    /** Another account's wall, and the 1:1 its button opens. */
    @Composable
    private fun Wall(
        account: String,
        nav: NavController,
    ) {
        val wall: PostsViewModel =
            viewModel(key = "wall-$account") { PostsViewModel(PostsViewModel.Source.Wall(account), graph.account) }
        val state by wall.state.collectAsStateWithLifecycle()
        LaunchedEffect(wall) {
            wall.opened.collect {
                graph.socket.sync()
                nav.navigate(conversation(it))
            }
        }
        WallScreen(state, postsActions(wall, state.me, nav), onBack = rememberBack(nav), onContact = wall::contact)
    }

    @Composable
    private fun Replies(
        postId: String,
        nav: NavController,
    ) {
        val model: RepliesViewModel = viewModel(key = "replies-$postId") { RepliesViewModel(postId, graph.account) }
        val state by model.state.collectAsStateWithLifecycle()
        val pop = rememberBack(nav)
        RepliesScreen(
            state,
            object : RepliesActions {
                override fun back() = pop()

                override fun author(person: Person) = openAuthor(person, state.me, nav)

                override fun heart() = model.toggleHeart()

                override fun deletePost() = model.deletePost()

                override fun share() = nav.navigate("$SHARE/$postId")

                override fun send(body: String) = model.send(body)

                override fun delete(replyId: String) = model.delete(replyId)

                override fun loadMore() = model.loadMore()

                override fun retry() = model.load()
            },
            model.sent,
        )
    }

    private fun postsActions(
        model: PostsViewModel,
        me: String?,
        nav: NavController,
    ) = object : PostsActions {
        override fun author(person: Person) = openAuthor(person, me, nav)

        override fun heart(post: Post) = model.toggleHeart(post)

        override fun replies(postId: String) = nav.navigate("$REPLIES/$postId")

        override fun delete(postId: String) = model.delete(postId)

        override fun share(postId: String) = nav.navigate("$SHARE/$postId")

        override fun post(body: String) = model.post(body)

        override fun loadMore() = model.loadMore()

        override fun refresh() = model.refresh()
    }

    /** An author's wall; this account's own is Ég. */
    private fun openAuthor(
        person: Person,
        me: String?,
        nav: NavController,
    ) {
        if (person.account == me) nav.navigate(ME) { tab() } else nav.navigate("$WALL/${person.account}")
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

                override fun search(text: String) = people.search(text)

                override fun more() = people.more()

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

                override fun forward(item: Item) {
                    item.seq?.let { nav.navigate("$FORWARD/$id/$it") }
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

                override fun fetch(item: Item) = model.fetch(item)

                override fun open(item: Item) = model.open(item)

                override fun showPost(postId: String) = model.showPost(postId)

                override fun openPost(postId: String) = nav.navigate("$REPLIES/$postId")

                override fun timer(seconds: UInt?) = model.timer(seconds)

                override fun mute(duration: MuteFor) = model.mute(duration)

                override fun unmute() = model.unmute()

                override fun block() = model.block()

                override fun retry() = model.retry()

                override fun paused() = model.paused()
            },
        )
    }

    /** Copies one message into the conversations picked (decision 0041), then back to where it came from. */
    @Composable
    private fun Forward(
        from: String,
        seq: ULong,
        nav: NavController,
    ) {
        val model: PickViewModel =
            viewModel(key = "forward-$from-$seq") {
                PickViewModel(graph.account, graph.socket, except = from) { to -> forward(from, seq, to) }
            }
        Pick(stringResource(R.string.forward), R.plurals.forward_done, model, nav)
    }

    /** Sends a Fljótið post into the conversations picked (decision 0040), then back to the post. */
    @Composable
    private fun SharePost(
        postId: String,
        nav: NavController,
    ) {
        val model: PickViewModel =
            viewModel(key = "share-$postId") { PickViewModel(graph.account, graph.socket, deliver = sharing(postId)) }
        Pick(stringResource(R.string.share_post), R.plurals.share_post_done, model, nav)
    }

    /** The conversation picker; once every picked conversation has its copy, says how many and goes back. */
    @Composable
    private fun Pick(
        title: String,
        done: Int,
        model: PickViewModel,
        nav: NavController,
    ) {
        val state by model.state.collectAsStateWithLifecycle()
        val pop = rememberBack(nav)
        LaunchedEffect(model) {
            model.done.collect { count ->
                Toast
                    .makeText(
                        this@MainActivity,
                        resources.getQuantityString(done, count, count),
                        Toast.LENGTH_SHORT,
                    ).show()
                nav.popBackStack()
            }
        }
        PickScreen(
            title,
            state,
            object : PickActions {
                override fun toggle(conversation: String) = model.toggle(conversation)

                override fun send() = model.send()

                override fun back() = pop()

                override fun retry() = model.retry()
            },
        )
    }

    /** Ég and its settings share one view model, so a change in one shows in the other. */
    @Composable
    private fun Me(
        signIns: Int,
        nav: NavController,
        settings: Boolean,
    ) {
        val me: MeViewModel =
            viewModel(viewModelStoreOwner = this, key = "me-$signIns") { MeViewModel(graph.account) }
        val state by me.state.collectAsStateWithLifecycle()
        val notificationsOff = notificationsOff()
        // Made small and square off the main thread, in the view model (decision 0039).
        val photo =
            rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
                uri?.let { me.setPhoto { graph.files.profilePhoto(it) } }
            }
        // A block from a conversation menu changes the list here, and the settings the row opens may change.
        LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { me.load() }
        LaunchedEffect(state.signedOut) {
            if (state.signedOut) {
                graph.socket.stop()
                signIn.signedOut()
            }
        }
        val actions =
            object : MeActions {
                override fun newLink() = me.newLink()

                override fun share(link: String) = this@MainActivity.share(link)

                override fun readMarkers(on: Boolean) = me.readMarkers(on)

                override fun typing(on: Boolean) = me.typing(on)

                override fun unblock(account: String) = me.unblock(account)

                override fun revoke(deviceId: String) = me.revoke(deviceId)

                override fun deleteAccount() = me.deleteAccount()

                override fun choosePhoto() =
                    photo.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))

                override fun removePhoto() = me.removePhoto()

                override fun retry() = me.retry()

                override fun notificationSettings() = this@MainActivity.notificationSettings()

                override fun verify() = nav.navigate(VERIFY)
            }
        if (settings) {
            SettingsScreen(state, actions, onBack = rememberBack(nav), notificationsOff = notificationsOff)
        } else {
            val wall: PostsViewModel =
                viewModel(viewModelStoreOwner = this, key = "mine-$signIns") {
                    PostsViewModel(PostsViewModel.Source.Mine, graph.account)
                }
            val posts by wall.state.collectAsStateWithLifecycle()
            LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { wall.refresh() }
            MeScreen(
                state,
                actions,
                onSettings = { nav.navigate(SETTINGS) },
                wall = posts,
                wallActions = postsActions(wall, posts.me, nav),
                posted = wall.posted,
            )
        }
    }

    /** Kenni's link (decision 0033); once linked, back to where it was opened, which reloads `me`. */
    @Composable
    private fun Verify(nav: NavController) {
        val state by signIn.state.collectAsStateWithLifecycle()
        val pop = rememberBack(nav)
        // Not [pop]: the link may finish before the screen is resumed again.
        LaunchedEffect(Unit) { signIn.linked.collect { nav.popBackStack(VERIFY, inclusive = true) } }
        VerifyScreen(
            state,
            onVerify = signIn::verify,
            onLater = pop,
            onRetry = signIn::retry,
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

        private const val FEED = "feed"
        private const val LIST = "conversations"
        private const val ME = "me"
        private const val SETTINGS = "settings"
        private const val VERIFY = "verify"
        private const val PEOPLE = "people"
        private const val CONVERSATION = "conversation"
        private const val FORWARD = "forward"
        private const val SHARE = "share"
        private const val WALL = "wall"
        private const val REPLIES = "replies"
        private val TABS = setOf(FEED, LIST, ME)
        private const val PREFS = "push"
        private const val ASKED_NOTIFICATIONS = "asked_notifications"

        private fun conversation(id: String) = "$CONVERSATION/$id"

        /** A tab keeps one copy of itself on the stack, above the list. */
        private fun NavOptionsBuilder.tab() {
            popUpTo(FEED) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    }
}
