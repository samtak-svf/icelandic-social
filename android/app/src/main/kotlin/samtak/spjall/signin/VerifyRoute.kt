package samtak.spjall.signin

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import samtak.spjall.ui.AppRoutes
import samtak.spjall.ui.rememberBack

/** Kenni's link (decision 0033); once linked, back to where it was opened, which reloads `me`. */
@Composable
internal fun VerifyRoute(
    nav: NavController,
    signIn: SignInViewModel,
) {
    val state by signIn.state.collectAsStateWithLifecycle()
    val pop = rememberBack(nav)
    // Not [pop]: the link may finish before the screen is resumed again.
    LaunchedEffect(Unit) { signIn.linked.collect { nav.popBackStack(AppRoutes.VERIFY, inclusive = true) } }
    VerifyScreen(
        state,
        onVerify = signIn::verify,
        onLater = pop,
        onRetry = signIn::retry,
    )
}
