package samtak.spjall.social

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import samtak.spjall.core.SocialNotification

/**
 * The notifications tab's screen with its view model: it loads each time it shows, and a tap on a row reads it
 * and goes to its post, or its community. [dismiss] takes the system notification of a row away.
 */
@Composable
internal fun NotificationsRoute(
    social: Social,
    nav: NavController,
    read: () -> Unit,
    dismiss: (String) -> Unit,
) {
    val model: NotificationsViewModel = viewModel { NotificationsViewModel(social, read, dismiss = dismiss) }
    val state by model.state.collectAsStateWithLifecycle()
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { model.load() }
    NotificationsScreen(
        state,
        object : NotificationsActions {
            override fun open(notification: SocialNotification) {
                model.opened(notification)
                when (val opens = notification.opens()) {
                    is Opens.Post -> nav.navigate(SocialRoutes.post(opens.postId))
                    is Opens.Community -> nav.navigate(SocialRoutes.community(opens.communityId))
                    Opens.Nowhere -> Unit
                }
            }

            override fun more() = model.more()

            override fun retry() = model.retry()

            override fun markAllRead() = model.markAllRead()

            override fun setRead(
                notification: SocialNotification,
                read: Boolean,
            ) = model.setRead(notification, read)

            override fun remove(notification: SocialNotification) = model.remove(notification)

            override fun kindInApp(notification: SocialNotification) = model.kindInApp(notification)

            override fun communityOff(notification: SocialNotification) = model.communityOff(notification)
        },
    )
}
