package samtak.spjall.social

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.LogTarget
import samtak.spjall.core.LogTargetKind
import samtak.spjall.core.ModerationLogAction
import samtak.spjall.core.ModerationReview
import samtak.spjall.core.ModerationReviewState
import samtak.spjall.core.ModerationState
import samtak.spjall.core.ModerationStatement
import samtak.spjall.ui.SpjallTheme

/**
 * The statements of reasons in each state a review can be in, their empty state, and what stands in a removed post's
 * place (decision 0115). See ConversationsScreenshotTest.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class StatementsScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun statement(
        id: ULong,
        action: ModerationLogAction = ModerationLogAction.REMOVE_POST,
        kind: LogTargetKind = LogTargetKind.POST,
        body: String? = "Textinn sem var fjarlægður",
        canAsk: Boolean = false,
        state: ModerationReviewState? = null,
        restored: Boolean = false,
    ) = ModerationStatement(
        entryId = id,
        action = action,
        target = LogTarget(kind, "t$id"),
        communityId = "k1",
        reason = "Brýtur gegn reglum samfélagsins",
        createdAt = 1_600_000_000_000uL,
        body = body,
        canAsk = canAsk,
        review =
            state?.let {
                ModerationReview(
                    state = it,
                    askedAt = 1_600_000_000_000uL,
                    decidedAt = null,
                    reason = "Ákvörðunin var skoðuð aftur".takeIf { _ -> it != ModerationReviewState.OPEN },
                    restored = restored,
                )
            },
    )

    private val every =
        StatementsViewModel.State(
            loaded = true,
            statements =
                listOf(
                    statement(1uL, canAsk = true),
                    statement(2uL, state = ModerationReviewState.OPEN),
                    statement(3uL, state = ModerationReviewState.UPHELD, body = null),
                    statement(4uL, state = ModerationReviewState.OVERTURNED, restored = true),
                    statement(
                        5uL,
                        action = ModerationLogAction.CLEAR_ACCOUNT_PHOTO,
                        kind = LogTargetKind.ACCOUNT,
                        body = null,
                        state = ModerationReviewState.OVERTURNED,
                    ),
                ),
        )

    private val none =
        object : StatementsActions {
            override fun back() = Unit

            override fun retry() = Unit

            override fun more() = Unit

            override fun ask(entryId: ULong) = Unit
        }

    @Test
    fun everyState() {
        compose.setContent { SpjallTheme { StatementsScreen(every, none) } }
        compose.onRoot().captureRoboImage()
    }

    @Test
    @Config(qualifiers = "+night")
    fun everyStateAtNight() {
        compose.setContent { SpjallTheme { StatementsScreen(every, none) } }
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun empty() {
        compose.setContent { SpjallTheme { StatementsScreen(StatementsViewModel.State(loaded = true), none) } }
        compose.onRoot().captureRoboImage()
    }

    /** Its author is offered the reasons, a moderator the post. */
    @Test
    fun tombstone() {
        val removed = post("p1", body = "", author = null, own = true, state = ModerationState.REMOVED)
        compose.setContent { SpjallTheme { PostTombstone(removed, moderates = true, onOpen = {}) } }
        compose.onRoot().captureRoboImage()
    }
}
