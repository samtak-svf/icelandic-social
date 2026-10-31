package samtak.spjall.social

import androidx.compose.foundation.clickable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role

/**
 * Opens the person screen of an account (0114); null in a screen test that provides none, where a name is plain
 * text. [WithSocialHost] provides it, so a post's or comment's author is a tap away from the person.
 */
val LocalOpenPerson = staticCompositionLocalOf<((String) -> Unit)?> { null }

/** Makes what it is applied to open [accountId]'s person screen; unchanged where nothing provides the way. */
@Composable
fun Modifier.opensPerson(accountId: String?): Modifier {
    val open = LocalOpenPerson.current
    return if (open == null || accountId == null) this else clickable(role = Role.Button) { open(accountId) }
}
