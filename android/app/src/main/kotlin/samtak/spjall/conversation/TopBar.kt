package samtak.spjall.conversation

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.plus
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import samtak.spjall.brand.R
import samtak.spjall.core.Conversation
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.Palette
import samtak.spjall.ui.SansFamily
import samtak.spjall.ui.VerifiedMark
import samtak.spjall.ui.avatarKind
import samtak.spjall.ui.photoOf
import samtak.spjall.ui.title

/** The cream band: back, who this is with, whether Kenni vouched for them, and the menu. */
@Composable
internal fun TopBar(
    state: ConversationViewModel.State,
    actions: ConversationActions,
) {
    Column(modifier = Modifier.fillMaxWidth().background(Palette.bg)) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
                    .padding(start = 4.dp, end = 4.dp, top = 2.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            IconButton(onClick = actions::back) {
                Icon(AppIcons.Back, contentDescription = stringResource(R.string.back), tint = Palette.fg)
            }
            state.conversation?.let {
                var info by rememberSaveable { mutableStateOf(false) }
                Title(it, Modifier.weight(1f)) { info = true }
                ConversationMenu(it, actions, info) { open -> info = open }
            }
        }
        HorizontalDivider(color = Palette.border)
    }
}

/** Who this is with; a tap opens the conversation's information (0043). */
@Composable
private fun Title(
    conversation: Conversation,
    modifier: Modifier,
    onInfo: () -> Unit,
) {
    val one = conversation.members.singleOrNull()
    val title = conversation.title()
    Row(
        modifier =
            modifier
                .heightIn(min = TARGET.dp)
                .clickable(
                    enabled = conversation.hasMenu(),
                    onClickLabel = stringResource(R.string.conversation_info),
                    role = Role.Button,
                    onClick = onInfo,
                ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(
            name = if (one == null) title else one.name,
            kind = conversation.avatarKind(),
            size = HEADER_AVATAR.dp,
            photo = conversation.photoOf(),
        )
        // The title has all the room the menu leaves; the mark sits right after it.
        Column(modifier = Modifier.weight(1f).padding(start = 8.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Text(
                    text = title,
                    style = TITLE,
                    color = Palette.fg,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false).semantics { heading() },
                )
                if (one?.verified == true) VerifiedMark()
            }
            if (one?.verified == true) {
                // The dot already says it to TalkBack; this is its visible word.
                Text(
                    text = stringResource(R.string.verified_short),
                    style = SUBTITLE,
                    color = Palette.mutedFg,
                    modifier = Modifier.clearAndSetSemantics {},
                )
            }
        }
    }
}

private const val HEADER_AVATAR = 38
private const val TARGET = 48

private val TITLE = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 15.5.sp)
private val SUBTITLE = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Medium, fontSize = 11.sp)
