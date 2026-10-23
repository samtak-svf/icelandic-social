package samtak.spjall.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Content
import samtak.spjall.core.Conversation
import samtak.spjall.core.Item
import samtak.spjall.core.Person

/** The name the server gave (decision 0022), or a word for none. */
@Composable
fun Person.shownName(): String = name ?: stringResource(R.string.person_unnamed)

/** The first word of the name, for where a whole name does not fit; Icelanders go by their first names. */
@Composable
fun Person.firstName(): String {
    val first = name?.split(' ')?.firstOrNull { it.isNotEmpty() }
    return first ?: stringResource(R.string.person_unnamed)
}

/**
 * A group is titled by the name it was given (0078), or by its members (0022) while it has none; a
 * conversation with no one else in it says so.
 */
@Composable
fun Conversation.title(): String =
    name ?: if (members.isEmpty()) stringResource(R.string.conversation_alone_title) else names(members)

@Composable
fun names(people: List<Person>): String = people.map { it.shownName() }.joinToString(", ")

/** Up to two letters: the first of the first and of the last name. */
fun initials(name: String?): String {
    val words = name?.split(' ')?.filter(String::isNotBlank).orEmpty()
    if (words.isEmpty()) return "?"
    return listOfNotNull(words.first(), words.drop(1).lastOrNull())
        .joinToString("") { it.first().uppercase() }
}

/** How an avatar is filled: who it stands for, and whether Kenni vouched for them. */
enum class AvatarKind { Verified, Unverified, Group, Me }

/**
 * A circle with the [photo] of whom a row is about (decision 0039), or their initials while it loads, when there
 * is none, or when it cannot be had. A verified name keeps its gold as a ring around a photo. The row's text says
 * who, so this says nothing.
 */
@Composable
fun Avatar(
    name: String?,
    modifier: Modifier = Modifier,
    kind: AvatarKind = AvatarKind.Verified,
    size: Dp = AVATAR_SIZE.dp,
    photo: PhotoOf? = null,
    shape: Shape = CircleShape,
) {
    val (fill, ink) =
        when (kind) {
            AvatarKind.Verified -> Palette.secondary to Palette.secondaryFg
            AvatarKind.Unverified -> Palette.fg.copy(alpha = GREY) to Palette.fg
            AvatarKind.Group -> Palette.secondarySubtle to Palette.fg
            AvatarKind.Me -> Palette.fg to Palette.surface
        }
    val image = rememberPhoto(photo)
    Box(
        modifier =
            modifier
                .size(size)
                .background(fill, shape)
                .clearAndSetSemantics {
                    testTag = if (image == null) AVATAR_INITIALS else AVATAR_PHOTO
                    if (image == null) avatarInitials = initials(name)
                },
        contentAlignment = Alignment.Center,
    ) {
        val shown = image
        if (shown == null) {
            Text(
                text = initials(name),
                color = ink,
                fontFamily = SansFamily,
                fontWeight = FontWeight.Black,
                fontSize = with(LocalDensity.current) { initialsSize(size) },
            )
        } else {
            val ring = if (kind == AvatarKind.Verified) Modifier.border(RING.dp, fill, shape) else Modifier
            Image(
                bitmap = shown,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().clip(shape).then(ring),
            )
        }
    }
}

/** What a screen test finds an [Avatar] by: drawn with its photo, or with initials. */
const val AVATAR_PHOTO = "avatar_photo"
const val AVATAR_INITIALS = "avatar_initials"

/**
 * The letters an [Avatar] draws when it has no photo. Its semantics are cleared, so a screen reader hears nothing
 * and a test cannot find the letters by text; this key, which accessibility services do not read, lets a test
 * check them.
 */
val AvatarInitials = SemanticsPropertyKey<String>("AvatarInitials")
private var SemanticsPropertyReceiver.avatarInitials by AvatarInitials

/** The avatar's fill for a conversation: a group, or its one member verified or not. */
fun Conversation.avatarKind(): AvatarKind =
    when {
        name != null || members.size > 1 -> AvatarKind.Group
        members.singleOrNull()?.verified == true -> AvatarKind.Verified
        else -> AvatarKind.Unverified
    }

/** The mark of a name Kenni verified: a gold shield with a check, which TalkBack reads as the words. */
@Composable
fun VerifiedMark(
    modifier: Modifier = Modifier,
    size: Dp = MARK.dp,
) {
    val description = stringResource(R.string.verified_with_kennitala)
    Box(modifier = modifier.size(size).semantics { contentDescription = description }) {
        Icon(AppIcons.Shield, contentDescription = null, tint = Palette.verifiedMark, modifier = Modifier.size(size))
        Icon(AppIcons.ShieldCheck, contentDescription = null, tint = Palette.surface, modifier = Modifier.size(size))
    }
}

/**
 * A name that may wrap, with [VerifiedMark] after its last word when
 * [verified]: inline in the text, so a second line takes the mark with it.
 */
@Composable
fun NameWithMark(
    name: String,
    verified: Boolean,
    style: TextStyle,
    color: Color,
    markSize: Dp,
    modifier: Modifier = Modifier,
) {
    val mark = with(LocalDensity.current) { markSize.toSp() }
    val description = stringResource(R.string.verified_with_kennitala)
    Text(
        text =
            buildAnnotatedString {
                append(name)
                if (verified) {
                    append(" ")
                    appendInlineContent(MARK_ID, description)
                }
            },
        style = style,
        color = color,
        modifier = modifier,
        inlineContent =
            mapOf(
                MARK_ID to
                    InlineTextContent(Placeholder(mark, mark, PlaceholderVerticalAlign.TextCenter)) {
                        VerifiedMark(size = markSize)
                    },
            ),
    )
}

/** An item as one line of the list; [group] words a member card for a group rather than a 1:1. */
@Suppress("CyclomaticComplexMethod") // One branch per kind of item, each a sentence of its own.
@Composable
fun lastLine(
    item: Item,
    group: Boolean = true,
): String =
    when (val content = item.content) {
        is Content.Text -> content.text
        is Content.Media ->
            content.caption
                ?: stringResource(if (content.mime.startsWith("image/")) R.string.photo else R.string.file)
        Content.Deleted -> stringResource(R.string.message_deleted)
        // Never the post's text or author: the list shows what the store holds (decision 0040).
        is Content.Post -> stringResource(R.string.post_shared)
        // Never the place: the list is seen over a shoulder as a notice is (decision 0059).
        is Content.Location -> stringResource(R.string.location)
        is Content.Unreadable -> stringResource(R.string.item_unreadable)
        is Content.Members ->
            when {
                content.added.isNotEmpty() -> stringResource(R.string.member_added_card, names(content.added))
                content.removed.isNotEmpty() ->
                    stringResource(
                        if (group) R.string.member_removed_card else R.string.member_removed_card_direct,
                        names(content.removed),
                    )
                else -> stringResource(R.string.new_device_card, names(content.devices))
            }
        is Content.Timer ->
            content.seconds?.let {
                stringResource(R.string.disappearing_set_card, item.sender.shownName(), duration(it))
            } ?: stringResource(R.string.disappearing_off_card, item.sender.shownName())
        // Who named the group, or took its name away (0078).
        is Content.Name -> {
            val named = content.name
            if (named != null) {
                stringResource(R.string.name_set_card, item.sender.shownName(), named)
            } else {
                stringResource(R.string.name_cleared_card, item.sender.shownName())
            }
        }
    }

/** A disappearing timer: whole days when it is, else hours (decision 0022). */
@Composable
fun duration(seconds: UInt): String {
    val s = seconds.toInt()
    return if (s % DAY == 0) {
        pluralStringResource(R.plurals.duration_days, s / DAY, s / DAY)
    } else {
        val hours = maxOf(1, s / HOUR)
        pluralStringResource(R.plurals.duration_hours, hours, hours)
    }
}

/** An avatar's side in dp, unless a screen asks for another. */
internal const val AVATAR_SIZE = 46
private const val MARK = 14
private const val MARK_ID = "mark"

/** The gold ring around a verified person's photo. */
private const val RING = 2

/** The grey of an unverified person's avatar: fg at 9 %. */
private const val GREY = 0.09f

/** Initials take a third of the circle, as in the design (15 on 46). */
private const val HOUR = 3_600
private const val DAY = 86_400
