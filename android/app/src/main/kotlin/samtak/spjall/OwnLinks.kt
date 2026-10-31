package samtak.spjall

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.navigation.NavController
import samtak.spjall.core.OwnLink
import samtak.spjall.core.ownLink
import samtak.spjall.social.SocialRoutes

/** The screen a link on our own host stands for (decision 0121); the core reads the link. */
fun ownRoute(
    link: String,
    read: (String) -> OwnLink? = ::ownLink,
): String? =
    when (val own = read(link)) {
        is OwnLink.Post -> SocialRoutes.post(own.id)
        is OwnLink.Community -> SocialRoutes.community(own.id)
        null -> null
    }

/** Opens a link to a screen in the app and leaves every other link to [other]. */
class OwnLinkHandler(
    private val route: (String) -> String?,
    private val open: (String) -> Unit,
    private val other: UriHandler,
) : UriHandler {
    override fun openUri(uri: String) {
        route(uri)?.let(open) ?: other.openUri(uri)
    }
}

/** A link tapped under [content] opens its screen over whatever is open, so back returns to where it was. */
@Composable
fun ProvideOwnLinks(
    nav: NavController,
    content: @Composable () -> Unit,
) {
    val platform = LocalUriHandler.current
    val handler = remember(nav, platform) { OwnLinkHandler({ ownRoute(it) }, { nav.navigate(it) }, platform) }
    CompositionLocalProvider(LocalUriHandler provides handler, content = content)
}

/**
 * A page under a claimed prefix that no screen stands for, handed to a browser by name: an implicit intent, a custom
 * tab's too, would resolve to this app again once the link is verified.
 */
fun openInBrowserApp(
    context: Context,
    uri: Uri,
) {
    val intent =
        Intent(Intent.ACTION_VIEW, uri).apply {
            selector = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_BROWSER)
        }
    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        // No browser on the device: the link goes nowhere, as any link would.
    }
}
