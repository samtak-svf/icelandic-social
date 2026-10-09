package samtak.spjall.ui

import androidx.compose.runtime.Composable
import androidx.lifecycle.compose.dropUnlessResumed
import androidx.navigation.NavController

/**
 * Back for a screen's own back button: it pops only while that screen is the
 * resumed one. A second tap during the exit transition would otherwise pop the
 * screen below as well, the list, and leave the tabs over nothing (#126).
 */
@Composable
fun rememberBack(nav: NavController): () -> Unit = dropUnlessResumed { nav.popBackStack() }
