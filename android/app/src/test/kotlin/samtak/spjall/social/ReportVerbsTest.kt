package samtak.spjall.social

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import samtak.spjall.core.ReportState
import samtak.spjall.core.ReportTargetKind
import samtak.spjall.core.TargetStanding
import samtak.spjall.core.TargetState
import samtak.spjall.social.ReportsViewModel.Verb

/** Which verbs a report offers for its target as it stands (#361); the same table as the web's `verbs`. */
class ReportVerbsTest {
    private fun offered(
        state: TargetState?,
        standing: TargetStanding?,
        report: ReportState = ReportState.OPEN,
    ) = report(
        "r",
        ReportTargetKind.POST,
        "p1",
        state = report,
        targetState = state,
        targetStanding = standing,
    ).let { r -> Verb.entries.filter { r.offers(it) }.toSet() }

    @Test
    fun aVisiblePostByAMemberCanBeHiddenRemovedOrItsAuthorMutedOrBanned() {
        assertEquals(
            setOf(Verb.Hide, Verb.Remove, Verb.Dismiss, Verb.Mute, Verb.Ban),
            offered(TargetState.VISIBLE, TargetStanding.MEMBER),
        )
    }

    @Test
    fun aHiddenPostCanBeRemovedOrRestored() {
        val verbs = offered(TargetState.HIDDEN, TargetStanding.MEMBER)
        assertTrue(Verb.Remove in verbs && Verb.Restore in verbs)
        assertFalse(Verb.Hide in verbs)
    }

    @Test
    fun aRemovedPostCanOnlyBeRestored() {
        val verbs = offered(TargetState.REMOVED, TargetStanding.MEMBER)
        assertTrue(Verb.Restore in verbs)
        assertFalse(Verb.Hide in verbs || Verb.Remove in verbs)
    }

    @Test
    fun aMutedAuthorCanBeUnmutedOrBannedButNotMutedAgain() {
        val verbs = offered(TargetState.VISIBLE, TargetStanding.MUTED)
        assertTrue(Verb.Unmute in verbs && Verb.Ban in verbs)
        assertFalse(Verb.Mute in verbs)
    }

    @Test
    fun aBannedAuthorCanOnlyBeUnbanned() {
        val verbs = offered(TargetState.VISIBLE, TargetStanding.BANNED)
        assertTrue(Verb.Unban in verbs)
        assertFalse(Verb.Mute in verbs || Verb.Ban in verbs || Verb.Unmute in verbs)
    }

    @Test
    fun anOwnerOrAGoneAccountHasNoAuthorVerbs() {
        for (standing in listOf(TargetStanding.OWNER, TargetStanding.GONE)) {
            val verbs = offered(TargetState.VISIBLE, standing)
            assertFalse(verbs.any { it in setOf(Verb.Mute, Verb.Unmute, Verb.Ban, Verb.Unban) })
        }
    }

    @Test
    fun anUnknownOrMissingStateOffersEverythingThatAppliesToTheKind() {
        val all =
            setOf(Verb.Hide, Verb.Remove, Verb.Restore, Verb.Dismiss, Verb.Mute, Verb.Unmute, Verb.Ban, Verb.Unban)
        assertEquals(all, offered(null, null))
        assertEquals(all, offered(TargetState.UNKNOWN, TargetStanding.UNKNOWN))
    }

    @Test
    fun aClosedReportIsNotDismissedAgain() {
        assertFalse(Verb.Dismiss in offered(null, null, ReportState.CLOSED))
    }
}
