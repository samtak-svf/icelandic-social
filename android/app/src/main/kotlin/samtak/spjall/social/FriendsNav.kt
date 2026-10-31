package samtak.spjall.social

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import samtak.spjall.core.FriendSort
import samtak.spjall.core.ReportReason
import samtak.spjall.core.WallAudience
import samtak.spjall.ui.rememberBack

// The friends screen and the person screen over their view models (decision 0114).

/** A social screen inside the host every one of them is given: the way to the statements and to a person. */
internal fun NavGraphBuilder.hostedScreen(
    social: Social,
    nav: NavController,
    route: String,
    content: @Composable (NavBackStackEntry) -> Unit,
) = composable(route) { entry ->
    WithSocialHost(
        social,
        openStatements = { nav.navigate(SocialRoutes.STATEMENTS) },
        openPerson = { nav.navigate(SocialRoutes.person(it)) },
    ) { content(entry) }
}

/** Registers the friends list and the person screen with [screen], which hosts them like the rest. */
internal fun friendScreens(
    social: Social,
    nav: NavController,
    screen: (String, @Composable (NavBackStackEntry) -> Unit) -> Unit,
) {
    screen(SocialRoutes.FRIENDS) { Friends(social, nav) }
    screen("${SocialRoutes.PERSON}/{id}") { entry ->
        entry.arguments?.getString("id")?.let { Person(it, social, nav) }
    }
}

@Composable
internal fun Friends(
    social: Social,
    nav: NavController,
) {
    val model: FriendsViewModel = viewModel(key = "friends") { FriendsViewModel(social) }
    val state by model.state.collectAsStateWithLifecycle()
    val back = rememberBack(nav)
    FriendsScreen(
        state,
        object : FriendsActions {
            override fun back() = back()

            override fun retry() = model.retry()

            override fun query(text: String) = model.onQuery(text)

            override fun sort(sort: FriendSort) = model.sortBy(sort)

            override fun open(accountId: String) = nav.navigate(SocialRoutes.person(accountId))

            override fun accept(accountId: String) = model.accept(accountId)

            override fun decline(accountId: String) = model.decline(accountId)

            override fun cancel(accountId: String) = model.cancel(accountId)

            override fun unsnooze(accountId: String) = model.unsnooze(accountId)
        },
    )
}

@Composable
internal fun Person(
    accountId: String,
    social: Social,
    nav: NavController,
) {
    val model: PersonViewModel = viewModel(key = "person-$accountId") { PersonViewModel(accountId, social) }
    PersonRoute(model, nav, tab = false)
}

/** The wall of [model]'s account as a screen; [tab] is this account's own, where the gear opens the settings. */
@Composable
internal fun PersonRoute(
    model: PersonViewModel,
    nav: NavController,
    tab: Boolean,
    settings: () -> Unit = {},
    chooseCover: () -> Unit = {},
    reframeCover: () -> Unit = {},
) {
    val state by model.state.collectAsStateWithLifecycle()
    val back = rememberBack(nav)
    PersonScreen(
        state,
        object : PersonActions {
            override fun back() = if (tab) nav.navigate(SocialRoutes.FRIENDS) else back()

            override fun retry() = model.retry()

            override fun open(accountId: String) = nav.navigate(SocialRoutes.person(accountId))

            override fun openCommunity(communityId: String) = nav.navigate(SocialRoutes.community(communityId))

            override fun add() = model.add()

            override fun cancel() = model.cancel()

            override fun accept() = model.accept()

            override fun decline() = model.decline()

            override fun end() = model.end()

            override fun snooze() = model.snooze()

            override fun unsnooze() = model.unsnooze()

            override fun settings() = settings()

            override fun openPost(postId: String) = nav.navigate(SocialRoutes.post(postId))

            override fun selectTab(tab: WallTab) = model.selectTab(tab)

            override fun morePosts() = model.morePosts()

            override fun moreImages() = model.moreImages()

            override fun draft(text: String) = model.onDraft(text)

            override fun audience(audience: WallAudience) = model.onAudience(audience)

            override fun publish() = model.publish()

            override fun postAudience(
                postId: String,
                audience: WallAudience,
            ) = model.setAudience(postId, audience)

            override fun deletePost(postId: String) = model.deletePost(postId)

            override fun react(
                postId: String,
                emoji: String,
            ) = model.react(postId, emoji)

            override fun saveBio(text: String) = model.saveBio(text)

            override fun chooseCover() = chooseCover()

            override fun reframeCover() = reframeCover()

            override fun removeCover() = model.removeCover()

            override fun report(
                reason: ReportReason,
                note: String,
            ) = model.report(reason, note)

            override fun block() = model.block()
        },
        tab = tab,
    )
}
