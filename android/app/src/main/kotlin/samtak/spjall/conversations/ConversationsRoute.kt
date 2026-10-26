package samtak.spjall.conversations

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import samtak.spjall.core.MuteFor
import samtak.spjall.ui.AppRoutes
import samtak.spjall.ui.conversationRoute
import samtak.spjall.ui.notificationsOff
import samtak.spjall.ui.openNotificationSettings
import samtak.spjall.ui.tab

/** The list tab: the conversations screen tied to its view model and the navigation graph. */
@Composable
internal fun ConversationsRoute(
    list: ConversationsViewModel,
    nav: NavController,
) {
    val state by list.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val notificationsOff = notificationsOff()
    ConversationsScreen(
        state,
        object : ConversationsActions {
            override fun open(conversation: String) = nav.navigate(conversationRoute(conversation))

            override fun newConversation() = nav.navigate(AppRoutes.PEOPLE)

            override fun search(text: String) = list.search(text)

            override fun openPerson(account: String) = list.openPerson(account)

            override fun invite() = nav.navigate(AppRoutes.ME) { tab() }

            override fun retry() = list.retry()

            override fun mute(
                conversation: String,
                duration: MuteFor,
            ) = list.mute(conversation, duration)

            override fun unmute(conversation: String) = list.unmute(conversation)

            override fun notificationSettings() = openNotificationSettings(context)
        },
        notificationsOff = notificationsOff,
    )
}
