package samtak.spjall.social

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.brand.R
import samtak.spjall.ui.SpjallTheme

@RunWith(AndroidJUnit4::class)
class CommunityPicturesTest {
    @get:Rule val compose = createComposeRule()

    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    @Composable
    private fun Row() {
        ImageRow(R.string.community_picture_choose, R.string.community_picture_remove, true, false, {}, {}, {})
    }

    /** One line of text is about one line tall: a button squeezed to a letter per line is many times that. */
    private fun assertBothOnWholeLines() {
        val choose =
            compose
                .onNodeWithText(text(R.string.community_picture_choose))
                .fetchSemanticsNode()
                .size.height
        val remove =
            compose
                .onNodeWithText(text(R.string.community_picture_remove))
                .fetchSemanticsNode()
                .size.height
        assertTrue("remove is $remove px tall beside choose at $choose px", remove <= choose * 3 / 2)
    }

    @Test
    fun bothButtonsKeepTheirTextOnWholeLinesOnANarrowScreen() {
        compose.setContent { SpjallTheme { Column(Modifier.width(360.dp)) { Row() } } }
        assertBothOnWholeLines()
    }

    @Test
    fun bothButtonsKeepTheirTextOnWholeLinesInsideTheDialog() {
        compose.setContent {
            SpjallTheme {
                AlertDialog(
                    onDismissRequest = {},
                    confirmButton = {},
                    text = {
                        Column {
                            Text("Breyta")
                            Row()
                        }
                    },
                )
            }
        }
        assertBothOnWholeLines()
    }
}
