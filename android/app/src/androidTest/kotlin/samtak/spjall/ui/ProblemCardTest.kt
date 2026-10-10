package samtak.spjall.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.account.Problem
import samtak.spjall.brand.R

/** A refusal names the server's request id so a tester can quote it (decision 0037). */
@RunWith(AndroidJUnit4::class)
class ProblemCardTest {
    @get:Rule val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun aRefusalShowsItsRequestId() {
        compose.setContent { SpjallTheme { ProblemCard(Problem.Generic("req-7f3a"), onRetry = {}) } }
        compose.onNodeWithText(context.getString(R.string.error_generic)).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.problem_request_id, "req-7f3a")).assertIsDisplayed()
    }

    @Test
    fun noRequestIdNoLine() {
        compose.setContent { SpjallTheme { ProblemCard(Problem.Generic(), onRetry = {}) } }
        compose.onNodeWithText(context.getString(R.string.error_generic)).assertIsDisplayed()
        // The line's fixed words, without the id, appear nowhere.
        val prefix = context.getString(R.string.problem_request_id, "").trim()
        compose.onNodeWithText(prefix, substring = true).assertDoesNotExist()
    }

    @Test
    fun aServerNeverReachedHasNoRequestId() {
        compose.setContent { SpjallTheme { ProblemCard(Problem.Unreachable, onRetry = {}) } }
        compose.onNodeWithText(context.getString(R.string.error_unreachable)).assertIsDisplayed()
        val prefix = context.getString(R.string.problem_request_id, "").trim()
        compose.onNodeWithText(prefix, substring = true).assertDoesNotExist()
    }
}
