package samtak.spjall.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.BrandTokens.Colors
import samtak.spjall.brand.R
import samtak.spjall.core.Content
import samtak.spjall.core.Conversation
import samtak.spjall.core.Item
import samtak.spjall.core.Person
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** The name the server gave (decision 0022), or a word for none. */
@Composable
fun Person.shownName(): String = name ?: stringResource(R.string.person_unnamed)

/** A group has no name in v1: it is titled by its members (decision 0022). */
@Composable
fun Conversation.title(): String = names(members)

@Composable
fun names(people: List<Person>): String = people.map { it.shownName() }.joinToString(", ")

/** Up to two letters: the first of the first and of the last name. */
fun initials(name: String?): String {
    val words = name?.split(' ')?.filter(String::isNotBlank).orEmpty()
    if (words.isEmpty()) return "?"
    return listOfNotNull(words.first(), words.drop(1).lastOrNull())
        .joinToString("") { it.first().uppercase() }
}

/** A circle with the initials of whom a row is about; the row's text says who, so this says nothing. */
@Composable
fun Avatar(
    name: String?,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier =
            modifier
                .size(AVATAR.dp)
                .background(MaterialTheme.colorScheme.secondary, CircleShape)
                .clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = initials(name),
            color = MaterialTheme.colorScheme.onSecondary,
            style = MaterialTheme.typography.titleMedium,
        )
    }
}

/** The mark of a name Kenni verified. */
@Composable
fun VerifiedMark(modifier: Modifier = Modifier) {
    Icon(
        imageVector = Icons.Filled.CheckCircle,
        contentDescription = stringResource(R.string.verified_with_kennitala),
        tint = Color(Colors.VERIFIED_MARK),
        modifier = modifier.size(MARK.dp),
    )
}

/** An item as one line of the list. */
@Composable
fun lastLine(item: Item): String =
    when (val content = item.content) {
        is Content.Text -> content.text
        is Content.Media ->
            content.caption
                ?: stringResource(if (content.mime.startsWith("image/")) R.string.photo else R.string.file)
        Content.Deleted -> stringResource(R.string.message_deleted)
        is Content.Members ->
            when {
                content.added.isNotEmpty() -> stringResource(R.string.member_added_card, names(content.added))
                content.removed.isNotEmpty() -> stringResource(R.string.member_removed_card, names(content.removed))
                else -> stringResource(R.string.new_device_card, names(content.devices))
            }
        is Content.Timer ->
            content.seconds?.let {
                stringResource(R.string.disappearing_set_card, item.sender.shownName(), duration(it))
            } ?: stringResource(R.string.disappearing_off_card, item.sender.shownName())
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

/** The time today, "yesterday", or the date. */
@Composable
fun shortTime(millis: ULong): String {
    val zone = ZoneId.systemDefault()
    val then = Instant.ofEpochMilli(millis.toLong()).atZone(zone)
    val today = LocalDate.now(zone)
    return when (then.toLocalDate()) {
        today -> DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).format(then)
        today.minusDays(1) -> stringResource(R.string.day_yesterday)
        else -> DateTimeFormatter.ofLocalizedDate(FormatStyle.SHORT).format(then)
    }
}

private const val AVATAR = 48
private const val MARK = 16
private const val HOUR = 3_600
private const val DAY = 86_400
