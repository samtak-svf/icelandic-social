package samtak.spjall.conversation

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import android.widget.Toast
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import samtak.spjall.brand.R
import samtak.spjall.ui.Type

/** A web link in a message (0046): where it is in the text, and what a tap opens. */
internal data class Link(
    val start: Int,
    val end: Int,
    val url: String,
) {
    fun written(text: String) = text.substring(start, end)
}

/**
 * The web links in [text] (0046): runs of non-space characters from `http://`, `https://` or
 * `www.`, less the punctuation that ends the sentence around them. A link opens with its scheme
 * lower-cased, as the core reads an own link (0121), and `www.` opens as `https://`. An address with no
 * host is no link. api/link.vectors.json holds this with iOS.
 */
internal fun links(text: String): List<Link> =
    START
        .findAll(text)
        .mapNotNull { match ->
            val written = trimEnd(match.value)
            val prefix = match.groupValues[1].lowercase()
            if (written.length <= prefix.length) return@mapNotNull null
            val rest = written.drop(prefix.length)
            val url = if (prefix == "www.") "https://www.$rest" else "$prefix$rest"
            if (hasHost(url)) Link(match.range.first, match.range.first + written.length, url) else null
        }.toList()

/** Whether [address] names a host: something before its path, query or port, and a port only of digits. */
private fun hasHost(address: String): Boolean {
    val authority =
        address
            .substringAfter("://")
            .takeWhile { it !in "/?#" }
            .substringAfterLast('@')
    val literal = authority.startsWith('[')
    val port = if (literal) authority.substringAfter(']', "\u0000") else authority.substringAfter(':', "")
    val digits = port.removePrefix(":").all { it in '0'..'9' }
    return digits && (if (literal) authority.indexOf(']') > 1 else authority.substringBefore(':').isNotEmpty())
}

/** Drops sentence punctuation, and a closing bracket or quote whose opening one is not in the link. */
private fun trimEnd(candidate: String): String {
    var link = candidate
    while (link.isNotEmpty()) {
        val last = link.last()
        val opener = CLOSERS[last]
        val closes = link.count { it == last }
        val drop =
            when {
                last in SENTENCE_END -> true
                opener == null -> false
                // A quote that opens and closes with one character is closed when it comes in pairs.
                opener == last -> closes % 2 == 1
                else -> link.count { it == opener } < closes
            }
        if (!drop) break
        link = link.dropLast(1)
    }
    return link
}

/**
 * A message's text with its web links underlined in the bubble's own colour. A tap on a link
 * opens it, a tap elsewhere is [onTap] (0045), and a long press anywhere, a link included, is
 * [onLongPress]: Compose's own link handling would open a link on a long press too.
 */
@Composable
internal fun LinkedText(
    text: String,
    color: Color,
    onTap: () -> Unit,
    onLongPress: () -> Unit,
) {
    val found = remember(text) { links(text) }
    if (found.isEmpty()) {
        Text(text = text, style = Type.bubble, color = color)
        return
    }
    val uri = LocalUriHandler.current
    val haptic = LocalHapticFeedback.current
    val tap by rememberUpdatedState(onTap)
    val longPress by rememberUpdatedState(onLongPress)
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val styled =
        remember(text) {
            buildAnnotatedString {
                append(text)
                found.forEach { addStyle(UNDERLINE, it.start, it.end) }
            }
        }
    Text(
        text = styled,
        style = Type.bubble,
        color = color,
        onTextLayout = { layout = it },
        modifier =
            Modifier.pointerInput(found) {
                detectTapGestures(
                    onLongPress = {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        longPress()
                    },
                    onTap = { at ->
                        val offset = layout?.getOffsetForPosition(at)
                        val link = found.firstOrNull { offset != null && offset >= it.start && offset < it.end }
                        if (link != null) uri.openUri(link.url) else tap()
                    },
                )
            },
    )
}

/** One TalkBack action per web link, as the bubble speaks for its text (0046). */
@Composable
internal fun linkActions(text: String?): List<CustomAccessibilityAction> {
    if (text == null) return emptyList()
    val uri = LocalUriHandler.current
    return links(text).map { link ->
        CustomAccessibilityAction(stringResource(R.string.link_open, link.written(text))) {
            uri.openUri(link.url)
            true
        }
    }
}

/** Copies a message's text: marked sensitive, confirmed where the system shows nothing (0046). */
@Composable
internal fun copier(): (String) -> Unit {
    val context = LocalContext.current
    return remember(context) { { text -> copy(context, text) } }
}

private fun copy(
    context: Context,
    text: String,
) {
    val clip = ClipData.newPlainText(null, text)
    clip.description.extras = PersistableBundle().apply { putBoolean(IS_SENSITIVE, true) }
    context.getSystemService(ClipboardManager::class.java).setPrimaryClip(clip)
    // Android 13 shows its own preview of what was copied.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        Toast.makeText(context, R.string.copied, Toast.LENGTH_SHORT).show()
    }
}

/**
 * Every white space by name: `\s` alone is ASCII on the JVM that runs the tests and wider on a phone, and a
 * no-break space ends a link everywhere.
 */
private const val NOT_SPACE = """[^\s\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]"""
private val START = Regex("""(?<![\p{L}\p{N}\p{M}])(https?://|www\.)$NOT_SPACE+""", RegexOption.IGNORE_CASE)
private const val SENTENCE_END = ".,;:!?"
private val CLOSERS =
    mapOf(
        ')' to '(',
        ']' to '[',
        '}' to '{',
        '"' to '"',
        '\'' to '\'',
        '”' to '“',
        '“' to '„',
        '’' to '‘',
        '‘' to '‚',
        '»' to '«',
    )
private val UNDERLINE = SpanStyle(textDecoration = TextDecoration.Underline)

/** `ClipDescription.EXTRA_IS_SENSITIVE`, named before Android 13 has the constant. */
private const val IS_SENSITIVE = "android.content.extra.IS_SENSITIVE"
