package samtak.spjall

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
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
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import samtak.spjall.brand.R
import samtak.spjall.conversation.ConversationInfoRoute
import samtak.spjall.conversation.ConversationWithPostsRoute
import samtak.spjall.conversations.ConversationsRoute
import samtak.spjall.conversations.ConversationsViewModel
import samtak.spjall.conversations.ForwardRoute
import samtak.spjall.conversations.SharePostRoute
import samtak.spjall.core.inviteToken
import samtak.spjall.frames.FrameSession
import samtak.spjall.frames.FrameSheet
import samtak.spjall.frames.LocalFrameSession
import samtak.spjall.me.MeRoute
import samtak.spjall.me.link.LinkRoute
import samtak.spjall.onboarding.OnboardingRoute
import samtak.spjall.onboarding.OnboardingViewModel
import samtak.spjall.onboarding.PrefsOnboardingStore
import samtak.spjall.onboarding.notificationsNeeded
import samtak.spjall.people.PeopleRoute
import samtak.spjall.signin.SignInScreen
import samtak.spjall.signin.SignInViewModel
import samtak.spjall.signin.SignInViewModel.Session
import samtak.spjall.signin.UpdateScreen
import samtak.spjall.signin.VerifyRoute
import samtak.spjall.social.SocialRoutes
import samtak.spjall.social.UnreadViewModel
import samtak.spjall.social.openNotifications
import samtak.spjall.social.socialScreens
import samtak.spjall.ui.AdaptiveNavigation
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.AppRoutes
import samtak.spjall.ui.Bell
import samtak.spjall.ui.LocalPhotos
import samtak.spjall.ui.SpjallTheme
import samtak.spjall.ui.Tab
import samtak.spjall.ui.conversationRoute
import samtak.spjall.ui.tab

/**
 * The one activity: sign-in, the first launch, then the tabs. It holds the navigation shell; each
 * destination's route composable, tying a view model to its screen, lives in that screen's package.
 */
class MainActivity : ComponentActivity() {
    private val graph get() = (application as SpjallApplication).graph

    private val signIn: SignInViewModel by viewModels {
        viewModelFactory { initializer { SignInViewModel(graph.account, createSavedStateHandle()) } }
    }

    /** A conversation a notification asked to open, held until the signed-in screens can. */
    private val opens = Channel<String>(Channel.CONFLATED)

    /** A route a social notification asked to open (decision 0107), held the same way. */
    private val socialOpens = Channel<String>(Channel.CONFLATED)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The bars' icons follow the system's mode, as the theme does (decision 0052).
        val bars = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT)
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

    /** Every sign-out ends here: the graph forgets the account first, then the sign-in screen returns (#337). */
    private fun signedOut() {
        graph.signedOut()
        signIn.signedOut()
    }

    /** A tapped notification, an invite link, or a provider's redirect back to the app's scheme. */
    private fun handle(intent: Intent) {
        when (intent.action) {
            ACTION_OPEN_CONVERSATION -> intent.getStringExtra(EXTRA_CONVERSATION)?.let { opens.trySend(it) }
            ACTION_OPEN_SOCIAL -> intent.getStringExtra(EXTRA_ROUTE)?.let { socialOpens.trySend(it) }
            else -> openLink(intent)
        }
    }

    private fun openLink(intent: Intent) {
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

    @Composable
    private fun App() {
        val state by signIn.state.collectAsStateWithLifecycle()
        val min by graph.update.min.collectAsStateWithLifecycle()
        // Below the server's floor nothing else would work (decision 0030).
        if (min != null) {
            val defaultUrl = stringResource(R.string.update_url_android)
            UpdateScreen(onUpdate = { openBrowser(graph.update.link(defaultUrl)) })
            return
        }
        when (state.session) {
            Session.Checking -> Unit
            Session.SignedOut -> SignInScreen(state, onSignIn = signIn::signIn, onRetry = signIn::retry)
            // Each sign-in starts over: new view models, and the list as the first screen.
            Session.SignedIn ->
                key(state.signIns) {
                    val frames: FrameSession =
                        viewModel(viewModelStoreOwner = this@MainActivity, key = "frames") { FrameSession() }
                    CompositionLocalProvider(LocalPhotos provides graph.photos, LocalFrameSession provides frames) {
                        Home(state.signIns)
                        FrameSheet()
                    }
                }
        }
    }

    /**
     * Once per install, the first launch's steps come before the tabs (decision 0043). Until they are done the
     * tabs are not composed, so the Kenni offer, an invite's 1:1 and a tapped notification wait for them.
     */
    @Composable
    private fun Home(signIns: Int) {
        val onboarding: OnboardingViewModel =
            viewModel(viewModelStoreOwner = this, key = "onboarding") {
                val app = applicationContext
                OnboardingViewModel(PrefsOnboardingStore(app)) { notificationsNeeded(app) }
            }
        val step by onboarding.step.collectAsStateWithLifecycle()
        LaunchedEffect(Unit) {
            graph.socket.start()
            // The server no longer answers this device's token: back to sign-in (decision 0057). The
            // start cleared what an earlier session left.
            graph.socket.signedOut.first { it }
            graph.socket.stop()
            signedOut()
        }
        if (step == OnboardingViewModel.Step.Done) {
            TabScreens(signIns)
        } else {
            OnboardingRoute(signIns, onboarding, step, owner = this, graph = graph)
        }
    }

    /** A tapped notification opens its conversation, or its post, over the tab it belongs to. */
    @Composable
    private fun OpenedFromNotifications(nav: NavController) {
        LaunchedEffect(Unit) {
            opens.receiveAsFlow().collect {
                nav.navigate(AppRoutes.LIST) { tab() }
                nav.navigate(conversationRoute(it))
            }
        }
        LaunchedEffect(Unit) {
            socialOpens.receiveAsFlow().collect {
                nav.navigate(SocialRoutes.NOTIFICATIONS) { tab() }
                nav.navigate(it)
            }
        }
    }

    /**
     * The three tabs, the conversation list, the communities and Ég (decisions 0044, 0063), the notifications behind
     * the bell in the header of every screen (0109, 0111), and the screens they lead to.
     */
    @Composable
    private fun TabScreens(signIns: Int) {
        val nav = rememberNavController()
        val list: ConversationsViewModel =
            viewModel(key = "list-$signIns") { ConversationsViewModel(graph.account, graph.socket) }
        LaunchedEffect(list) { signIn.invites.collect { list.openInvite(it.token, it.signedUp) } }
        LaunchedEffect(list) { list.opened.collect { nav.navigate(conversationRoute(it)) } }
        // Kenni is offered once after a sign-in, and "Seinna" goes on to the list (decision 0035).
        LaunchedEffect(Unit) { signIn.offers.collect { nav.navigate(AppRoutes.VERIFY) } }
        OpenedFromNotifications(nav)
        val route =
            nav
                .currentBackStackEntryAsState()
                .value
                ?.destination
                ?.route
        // The bell's count, asked for on every change of screen, as the web does (decisions 0067, 0109).
        val unread: UnreadViewModel = viewModel(key = "unread-$signIns") { UnreadViewModel(graph.social) }
        val count by unread.count.collectAsStateWithLifecycle()
        LaunchedEffect(route) { unread.refresh() }
        LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { unread.refresh() }
        val go: (String) -> Unit = { nav.navigate(it) { tab() } }
        // Each screen pads for the status bar itself, so its cream band can reach the top edge.
        AdaptiveNavigation(
            tabs = tabs(route, go),
            bell = bell(route, count) { nav.openNotifications() },
            shown = route in TABS,
            wide = route in SocialRoutes.WIDE,
        ) {
            NavHost(
                navController = nav,
                startDestination = AppRoutes.LIST,
            ) {
                composable(AppRoutes.LIST) { ConversationsRoute(list, nav) }
                composable(AppRoutes.ME) { MeRoute(signIns, nav, graph, this@MainActivity, ::signedOut) }
                socialScreens(
                    graph.social,
                    graph.account,
                    graph.files,
                    nav,
                    unread::refresh,
                    sharePost = { post -> nav.navigate("${AppRoutes.SHARE}/$post") },
                    dismissNotice = graph.push::dismissNotice,
                )
                composable(AppRoutes.VERIFY) { VerifyRoute(nav, signIn) }
                composable(AppRoutes.LINK) { LinkRoute(nav, graph) }
                composable(AppRoutes.PEOPLE) { PeopleRoute(nav, graph) }
                // Adding to a group that exists (0078): the picker, for that conversation's members.
                composable("${AppRoutes.PEOPLE}/{id}") { entry ->
                    entry.arguments?.getString("id")?.let { PeopleRoute(nav, graph, targetConversation = it) }
                }
                composable("${AppRoutes.CONVERSATION}/{id}") { entry ->
                    entry.arguments?.getString("id")?.let { ConversationWithPostsRoute(it, nav, graph) }
                }
                composable("${AppRoutes.INFO}/{id}") { entry ->
                    entry.arguments?.getString("id")?.let { ConversationInfoRoute(it, nav, graph) }
                }
                sendingRoutes(nav)
            }
        }
    }

    /** The two pickers that copy something into the conversations picked: a message (0041) and a post (0080). */
    private fun NavGraphBuilder.sendingRoutes(nav: NavController) {
        composable("${AppRoutes.SHARE}/{postId}") { entry ->
            entry.arguments?.getString("postId")?.let { SharePostRoute(it, nav, graph) }
        }
        composable("${AppRoutes.FORWARD}/{from}/{seq}") { entry ->
            val from = entry.arguments?.getString("from")
            val seq = entry.arguments?.getString("seq")?.toULongOrNull()
            if (from != null && seq != null) ForwardRoute(from, seq, nav, graph)
        }
    }

    companion object {
        /** A notification's tap (push/SystemNotifier.kt), with [EXTRA_CONVERSATION] unless it is the fallback. */
        const val ACTION_OPEN_CONVERSATION = "samtak.spjall.OPEN_CONVERSATION"
        const val EXTRA_CONVERSATION = "conversation"

        /** A social notification's tap (push/SystemNotifier.kt), with the route to open in [EXTRA_ROUTE]. */
        const val ACTION_OPEN_SOCIAL = "samtak.spjall.OPEN_SOCIAL"
        const val EXTRA_ROUTE = "route"

        // The notifications screen is no tab, but it is reached from every tab and keeps the tabs under it.
        private val TABS =
            setOf(AppRoutes.LIST, SocialRoutes.COMMUNITIES, SocialRoutes.NOTIFICATIONS, AppRoutes.ME)
    }
}

/** The three tabs; notifications are behind the bell (decision 0109). */
@Composable
private fun tabs(
    route: String?,
    go: (String) -> Unit,
): List<Tab> {
    val communities = SocialRoutes.COMMUNITIES
    return listOf(
        Tab(AppIcons.Chat, stringResource(R.string.tab_conversations), route == AppRoutes.LIST) {
            go(AppRoutes.LIST)
        },
        Tab(AppIcons.Communities, stringResource(R.string.tab_communities), route == communities) {
            go(communities)
        },
        Tab(AppIcons.Person, stringResource(R.string.tab_me), route == AppRoutes.ME) { go(AppRoutes.ME) },
    )
}

/** The bell at the end of every full screen's header, with the unread count, red on the notifications screen. */
@Composable
private fun bell(
    route: String?,
    unread: Long,
    open: () -> Unit,
): Bell =
    Bell(
        label = stringResource(R.string.notifications_title),
        unread = unread,
        unreadDescription =
            if (unread > 0) pluralStringResource(R.plurals.notifications_unread, unread.toInt(), unread) else null,
        selected = route == SocialRoutes.NOTIFICATIONS,
        onClick = open,
    )
