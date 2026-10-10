package samtak.spjall.feed

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import samtak.spjall.brand.R
import samtak.spjall.core.Person
import samtak.spjall.core.Post
import samtak.spjall.me.Confirm
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.Palette
import samtak.spjall.ui.SansFamily
import samtak.spjall.ui.Type
import samtak.spjall.ui.VerifiedMark
import samtak.spjall.ui.listStamp
import samtak.spjall.ui.shownName

/**
 * One post (the Fljotid artboard): the author's initials, name and mark, how
 * long ago, the text, then the heart and the replies. Every post has a menu
 * that sends it into conversations (decision 0040); the author's own also
 * deletes it, after asking. [PostActions.replies] is null on the replies
 * screen itself.
 */
@Composable
fun PostRow(
    post: Post,
    mine: Boolean,
    actions: PostActions,
    modifier: Modifier = Modifier,
) {
    var deleting by rememberSaveable { mutableStateOf(false) }
    Row(
        modifier = modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 12.dp, bottom = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Avatar(
            post.author,
            size = AVATAR.dp,
            modifier = Modifier.clickable(role = Role.Button) { actions.author(post.author) },
        )
        Column(modifier = Modifier.weight(1f)) {
            Byline(post.author, post.createdAt, onAuthor = { actions.author(post.author) }) {
                Menu(onShare = actions.share, onDelete = if (mine) ({ deleting = true }) else null)
            }
            Text(
                text = post.body,
                style = Type.bubble,
                color = Palette.fg,
                modifier = Modifier.padding(end = 12.dp),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                val hearted = post.myReaction != null
                Action(
                    icon = if (hearted) AppIcons.HeartFilled else AppIcons.Heart,
                    count = post.reactions.total(),
                    description = stringResource(R.string.post_react),
                    tint = if (hearted) Palette.primary else Palette.mutedFg,
                    onClick = actions.heart,
                )
                actions.replies?.let {
                    Action(
                        icon = AppIcons.Bubble,
                        count = post.replyCount,
                        description = stringResource(R.string.post_reply),
                        tint = Palette.mutedFg,
                        onClick = it,
                    )
                }
            }
        }
    }
    if (deleting) {
        Confirm(
            text = stringResource(R.string.post_delete_confirm),
            confirm = stringResource(R.string.delete),
            onConfirm = {
                deleting = false
                actions.delete()
            },
            onDismiss = { deleting = false },
        )
    }
}

/** What one [PostRow] can ask for; each list binds them to its post. */
class PostActions(
    val author: (Person) -> Unit,
    val heart: () -> Unit,
    val replies: (() -> Unit)?,
    val delete: () -> Unit,
    val share: () -> Unit,
)

/** The name, its mark and the time, the name opening the author's wall; [end] sits at the far side. */
@Composable
internal fun Byline(
    author: Person,
    createdAt: ULong,
    onAuthor: () -> Unit,
    end: @Composable () -> Unit = {},
) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.heightIn(min = BYLINE.dp)) {
        Row(
            modifier = Modifier.weight(1f).clickable(role = Role.Button, onClick = onAuthor),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(text = author.shownName(), style = NAME, color = Palette.fg, maxLines = 1)
            if (author.verified) VerifiedMark(size = MARK.dp)
            Text(text = listStamp(createdAt), style = Type.meta, color = Palette.mutedFg, maxLines = 1)
        }
        end()
    }
}

@Composable
private fun Menu(
    onShare: () -> Unit,
    onDelete: (() -> Unit)?,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }, modifier = Modifier.size(MENU.dp)) {
            Icon(AppIcons.More, contentDescription = stringResource(R.string.more_options), tint = Palette.mutedFg)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = Palette.surface) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.share_post), color = Palette.fg) },
                onClick = {
                    open = false
                    onShare()
                },
            )
            onDelete?.let {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.delete), color = Palette.danger) },
                    onClick = {
                        open = false
                        it()
                    },
                )
            }
        }
    }
}

/** An icon and, when there are any, how many; TalkBack reads the label and the count. */
@Composable
private fun Action(
    icon: ImageVector,
    count: UInt,
    description: String,
    tint: androidx.compose.ui.graphics.Color,
    onClick: () -> Unit,
) {
    val label = if (count > 0u) "$description, $count" else description
    TextButton(
        onClick = onClick,
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = label },
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(ICON.dp))
        if (count > 0u) {
            Text(text = count.toString(), style = COUNT, color = tint, modifier = Modifier.padding(start = 6.dp))
        }
    }
}

private const val AVATAR = 40
private const val MARK = 15
private const val BYLINE = 40
private const val MENU = 40
private const val ICON = 18

private val NAME = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 14.sp)
private val COUNT = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 12.sp)
