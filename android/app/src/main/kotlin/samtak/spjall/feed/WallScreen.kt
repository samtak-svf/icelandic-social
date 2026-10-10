package samtak.spjall.feed

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import samtak.spjall.brand.R
import samtak.spjall.core.Person
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.NameWithMark
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.SansFamily
import samtak.spjall.ui.Type
import samtak.spjall.ui.capitals
import samtak.spjall.ui.shownName

/**
 * Another account's wall (the Veggur artboard, decision 0034): who they are,
 * the button that opens the encrypted 1:1 with them, and their posts. The
 * button is not there for a blocked account.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WallScreen(
    state: PostsViewModel.State,
    actions: PostsActions,
    onBack: () -> Unit,
    onContact: () -> Unit,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.surface) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))) {
            PullToRefreshBox(
                isRefreshing = state.refreshing && state.loaded,
                onRefresh = actions::refresh,
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    item(key = "header") {
                        Header(
                            state.person,
                            contact = !state.blocked && state.person?.account != state.me,
                            onBack,
                            onContact,
                        )
                    }
                    state.problem?.let {
                        item(key = "problem") {
                            Box(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                                ProblemCard(it, actions::refresh)
                            }
                        }
                    }
                    posts(state, actions, empty = R.string.wall_empty)
                }
            }
        }
    }
}

/** The cream band: back, then the large initials, the name and its mark, and the 1:1 button. */
@Composable
private fun Header(
    person: Person?,
    contact: Boolean,
    onBack: () -> Unit,
    onContact: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(Palette.bg)
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
                .padding(start = 4.dp, end = 20.dp, top = 2.dp, bottom = 16.dp),
    ) {
        IconButton(onClick = onBack) {
            Icon(AppIcons.Back, contentDescription = stringResource(R.string.back), tint = Palette.fg)
        }
        person ?: return@Column
        Column(
            modifier = Modifier.padding(start = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Avatar(person, size = AVATAR.dp)
            NameWithMark(
                person.shownName().capitals(),
                person.verified,
                style = Type.accountName,
                color = Palette.fg,
                markSize = MARK.dp,
                modifier = Modifier.semantics { heading() },
            )
            if (contact) {
                Button(
                    onClick = onContact,
                    shape = RoundedCornerShape(PILL_RADIUS.dp),
                    modifier = Modifier.heightIn(min = PILL.dp),
                ) { Text(stringResource(R.string.contact_action), style = PILL_TEXT) }
            }
        }
    }
}

private const val AVATAR = 88
private const val MARK = 22
private const val PILL = 44
private const val PILL_RADIUS = 22

private val PILL_TEXT = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 13.5.sp)
