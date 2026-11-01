package samtak.spjall.conversation

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.Person
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.NameWithMark
import samtak.spjall.ui.Palette
import samtak.spjall.ui.Type
import samtak.spjall.ui.names
import samtak.spjall.ui.shownName

/** Faces drawn under a message before the rest fold into "+N" (0125). */
internal const val FACES_SHOWN = 4

/** The faces to draw and how many more there are; the core decided who (0125). */
internal fun readFaces(people: List<Person>): Pair<List<Person>, Int> =
    people.take(FACES_SHOWN) to (people.size - FACES_SHOWN).coerceAtLeast(0)

/**
 * Who has read up to a message in a group (0125): up to four small faces and "+N" on a button that opens
 * everyone by name. Its spoken form names everyone, those folded into "+N" too.
 */
@Composable
internal fun ReadFaces(
    people: List<Person>,
    modifier: Modifier = Modifier,
) {
    if (people.isEmpty()) return
    var open by remember { mutableStateOf(false) }
    val (shown, more) = readFaces(people)
    val spoken = stringResource(R.string.read_by_faces, names(people))
    Row(
        modifier =
            modifier
                .defaultMinSize(minWidth = TOUCH.dp, minHeight = TOUCH.dp)
                .clickable(role = Role.Button) { open = true }
                .clearAndSetSemantics { contentDescription = spoken }
                .padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(OVERLAP.dp)) {
            shown.forEach { person ->
                Avatar(person, modifier = Modifier.border(RING.dp, Palette.surface, CircleShape), size = FACE.dp)
            }
        }
        if (more > 0) {
            Text(text = stringResource(R.string.read_by_more, more), style = Type.meta, color = Palette.mutedFg)
        }
    }
    if (open) ReadBySheet(people) { open = false }
}

/** "Lesið af": everyone who has read, by name, so nobody behind "+N" stays hidden (0125). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReadBySheet(
    people: List<Person>,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.surface) {
        Column(modifier = Modifier.verticalScroll(rememberScrollState()).padding(bottom = 16.dp)) {
            Text(
                text = stringResource(R.string.read_by_title),
                style = MaterialTheme.typography.titleMedium,
                color = Palette.fg,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp).semantics { heading() },
            )
            people.forEach { person ->
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = LINE.dp)
                            .padding(horizontal = 16.dp, vertical = 6.dp)
                            .semantics(mergeDescendants = true) { },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(person, size = SHEET_FACE.dp)
                    NameWithMark(
                        name = person.shownName(),
                        verified = person.verified,
                        style = MaterialTheme.typography.bodyLarge,
                        color = Palette.fg,
                        modifier = Modifier.padding(start = 12.dp),
                        markSize = 14.dp,
                    )
                }
            }
        }
    }
}

private const val TOUCH = 48
private const val FACE = 20
private const val RING = 2
private const val OVERLAP = -6
private const val LINE = 56
private const val SHEET_FACE = 36
