package samtak.spjall.social

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import samtak.spjall.brand.R
import samtak.spjall.core.LogTargetKind
import samtak.spjall.core.ModerationLogAction
import samtak.spjall.core.ModerationReview
import samtak.spjall.core.ModerationReviewState
import samtak.spjall.core.ModerationStatement
import samtak.spjall.me.Confirm
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.dateTime
import samtak.spjall.ui.listStamp

/** The screen with its view model. */
@Composable
internal fun Statements(
    social: Social,
    nav: NavController,
) {
    val model: StatementsViewModel = viewModel { StatementsViewModel(social) }
    val state by model.state.collectAsStateWithLifecycle()
    StatementsScreen(
        state,
        object : StatementsActions {
            override fun back() {
                nav.popBackStack()
            }

            override fun retry() = model.retry()

            override fun more() = model.more()

            override fun ask(entryId: ULong) = model.ask(entryId)
        },
    )
}

/** What moderators did to this account's content and why (0115). It never says who acted. */
@Composable
fun StatementsScreen(
    state: StatementsViewModel.State,
    actions: StatementsActions,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(SUB_SCREEN_SIDES))) {
            SubHeader(stringResource(R.string.statements_title), actions::back)
            if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            LazyColumn(
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem) { actions.retry() } } }
                if (state.loaded && state.problem == null && state.statements.isEmpty()) {
                    item(key = "empty") { Muted(stringResource(R.string.statements_empty)) }
                }
                items(state.statements, key = { it.entryId.toString() }) { statement ->
                    StatementCard(statement, enabled = !state.busy) { actions.ask(statement.entryId) }
                }
                if (state.next != null && state.problem == null) {
                    item(key = "more") { LaunchedEffect(state.next) { actions.more() } }
                }
            }
        }
    }
}

/** One statement: what was done, why, the text while it is kept, and the review. */
@Composable
private fun StatementCard(
    statement: ModerationStatement,
    enabled: Boolean,
    onAsk: () -> Unit,
) {
    SocialCard {
        Text(
            text = statement.action.statementLabel(statement.until).text(),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.semantics { heading() },
        )
        Muted(listStamp(statement.createdAt))
        Labelled(R.string.report_reason, statement.reason)
        val body = statement.body
        when {
            body != null -> Text(body, style = MaterialTheme.typography.bodyMedium)
            statement.target.kind != LogTargetKind.ACCOUNT -> Muted(stringResource(R.string.statement_text_gone))
        }
        statement.review?.let { Review(it, statement.action) }
        if (statement.canAsk) Ask(enabled, onAsk)
    }
}

@Composable
private fun Labelled(
    label: Int,
    text: String,
) {
    Text("${stringResource(label)}: $text", style = MaterialTheme.typography.bodyMedium)
}

@Composable
private fun Review(
    review: ModerationReview,
    action: ModerationLogAction,
) {
    review.sentence(action)?.let { Text(stringResource(it), style = MaterialTheme.typography.bodyMedium) }
    review.reason?.let { Labelled(R.string.statement_review_reason, it) }
}

/** The one ask, confirmed first because it cannot be taken back. */
@Composable
private fun Ask(
    enabled: Boolean,
    onAsk: () -> Unit,
) {
    var asking by rememberSaveable { mutableStateOf(false) }
    Muted(stringResource(R.string.statement_ask_once))
    Button(onClick = { asking = true }, enabled = enabled, modifier = Modifier.heightIn(min = 44.dp)) {
        Text(stringResource(R.string.statement_ask))
    }
    if (asking) {
        Confirm(
            text = stringResource(R.string.statement_ask_confirm),
            confirm = stringResource(R.string.statement_ask),
            onConfirm = {
                asking = false
                onAsk()
            },
            onDismiss = { asking = false },
        )
    }
}

/**
 * The sentence a review's state reads as; a state a later server adds reads as nothing. What was overturned decides
 * the words (0115): a lifted suspension is not content that came back.
 */
internal fun ModerationReview.sentence(action: ModerationLogAction): Int? =
    when (state) {
        ModerationReviewState.OPEN -> R.string.statement_review_open
        ModerationReviewState.UPHELD -> R.string.statement_review_upheld
        ModerationReviewState.OVERTURNED -> overturned(action)
        ModerationReviewState.UNKNOWN -> null
    }

private fun ModerationReview.overturned(action: ModerationLogAction): Int =
    when {
        action == ModerationLogAction.SUSPEND_ACCOUNT && restored -> R.string.statement_review_overturned_lifted
        action == ModerationLogAction.SUSPEND_ACCOUNT -> R.string.statement_review_overturned_later_stands
        restored -> R.string.statement_review_overturned
        else -> R.string.statement_review_overturned_not_restored
    }

/** A sentence of the brand's and, when it names a date, that date in epoch milliseconds. */
internal data class Wording(
    @StringRes val id: Int,
    val date: ULong? = null,
)

@Composable
internal fun Wording.text(): String = if (date == null) stringResource(id) else stringResource(id, dateTime(date))

/**
 * What a statement or a log entry says was done. A suspension says how long it was for, or that it stands until a
 * moderator lifts it when it has no end (0115). Every action is named, so one a later lock adds does not compile
 * until it is worded; only a value this app cannot read reads as done.
 */
internal fun ModerationLogAction.statementLabel(until: ULong? = null): Wording =
    when (this) {
        ModerationLogAction.HIDE_POST -> Wording(R.string.moderation_decision_hide_post)
        ModerationLogAction.REMOVE_POST -> Wording(R.string.moderation_decision_remove_post)
        ModerationLogAction.HIDE_COMMENT -> Wording(R.string.moderation_decision_hide_comment)
        ModerationLogAction.REMOVE_COMMENT -> Wording(R.string.moderation_decision_remove_comment)
        ModerationLogAction.CLEAR_ACCOUNT_PHOTO -> Wording(R.string.moderation_decision_clear_account_photo)
        ModerationLogAction.SUSPEND_ACCOUNT ->
            if (until == null) {
                Wording(R.string.moderation_decision_suspend_account_open)
            } else {
                Wording(R.string.moderation_decision_suspend_account_until, until)
            }
        ModerationLogAction.UNSUSPEND_ACCOUNT -> Wording(R.string.moderation_decision_unsuspend_account)
        ModerationLogAction.REVIEW_UPHELD -> Wording(R.string.moderation_log_review_upheld)
        ModerationLogAction.REVIEW_OVERTURNED -> Wording(R.string.moderation_log_review_overturned)
        ModerationLogAction.RESTORE_POST,
        ModerationLogAction.RESTORE_COMMENT,
        ModerationLogAction.MUTE_MEMBER,
        ModerationLogAction.UNMUTE_MEMBER,
        ModerationLogAction.REMOVE_MEMBER,
        ModerationLogAction.BAN_MEMBER,
        ModerationLogAction.UNBAN_MEMBER,
        ModerationLogAction.CLOSE_REPORT,
        ModerationLogAction.DELETE_COMMUNITY,
        ModerationLogAction.RESTORE_COMMUNITY,
        ModerationLogAction.SET_COMMUNITY_PICTURE,
        ModerationLogAction.REMOVE_COMMUNITY_PICTURE,
        ModerationLogAction.SET_COMMUNITY_COVER,
        ModerationLogAction.REMOVE_COMMUNITY_COVER,
        ModerationLogAction.PIN_POST,
        ModerationLogAction.UNPIN_POST,
        ModerationLogAction.CLOSE_POLL,
        ModerationLogAction.ANONYMOUS_POSTS_ON,
        ModerationLogAction.ANONYMOUS_POSTS_OFF,
        ModerationLogAction.REVEAL_AUTHOR,
        ModerationLogAction.UNKNOWN,
        -> Wording(R.string.moderation_done)
    }
