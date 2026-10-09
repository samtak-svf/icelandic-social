package samtak.spjall.feed

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.Flow
import samtak.spjall.brand.R
import samtak.spjall.ui.Palette
import samtak.spjall.ui.SansFamily
import samtak.spjall.ui.Type

/**
 * The posts of [state], each under a hairline, then the next page once the
 * last one shows; [empty] when there are none. Own posts can be deleted.
 */
fun LazyListScope.posts(
    state: PostsViewModel.State,
    actions: PostsActions,
    empty: Int,
) {
    if (state.loaded && state.posts.isEmpty() && state.problem == null) {
        item(key = "empty") { Hint(empty) }
    }
    items(state.posts, key = { it.postId }) { post ->
        PostRow(
            post,
            mine = post.author.account == state.me,
            actions =
                PostActions(
                    author = actions::author,
                    heart = { actions.heart(post) },
                    replies = { actions.replies(post.postId) },
                    delete = { actions.delete(post.postId) },
                ),
        )
        HorizontalDivider(color = Palette.border)
        if (post == state.posts.last() && state.next != null) {
            LaunchedEffect(post.postId) { actions.loadMore() }
        }
    }
    if (state.loadingMore) {
        item(key = "more") {
            Box(modifier = Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Palette.primary)
            }
        }
    }
}

@Composable
internal fun Hint(text: Int) {
    Text(
        text = stringResource(text),
        style = Type.bubble,
        color = Palette.mutedFg,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 24.dp),
    )
}

/** The rounded field that is not one yet: a tap opens [ComposerSheet]. */
@Composable
fun ComposePill(
    placeholder: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(PILL_RADIUS.dp)
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .heightIn(min = PILL.dp)
                .background(Palette.surface, shape)
                .border(1.dp, Palette.border, shape)
                .clickable(role = Role.Button, onClick = onClick)
                .padding(horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = placeholder, style = Type.bubble, color = Palette.mutedFg)
    }
}

/**
 * A sheet to write a post: the field, then cancel and post. It closes on
 * [posted], so a refused post keeps its text.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ComposerSheet(
    placeholder: String,
    busy: Boolean,
    posted: Flow<Unit>,
    onPost: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var text by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(posted) {
        posted.collect {
            text = ""
            onDismiss()
        }
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Palette.surface,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 16.dp).imePadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedTextField(
                value = text,
                onValueChange = { if (it.length <= POST_LIMIT) text = it },
                placeholder = { Text(placeholder) },
                textStyle = Type.bubble,
                minLines = 4,
                modifier = Modifier.fillMaxWidth(),
                colors =
                    OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Palette.fg,
                        unfocusedBorderColor = Palette.border,
                    ),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "${text.length}/$POST_LIMIT",
                    style = Type.meta,
                    color = Palette.mutedFg,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
                Button(onClick = { onPost(text) }, enabled = !busy && postable(text) != null) {
                    Text(stringResource(R.string.post_action), style = ACTION)
                }
            }
        }
    }
}

private const val PILL = 48
private const val PILL_RADIUS = 24

private val ACTION = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 13.5.sp)
