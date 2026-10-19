package samtak.spjall.social

import samtak.spjall.core.Report
import samtak.spjall.core.ReportState
import samtak.spjall.core.TargetStanding
import samtak.spjall.core.TargetState

/**
 * Whether [verb] applies to what [this] names as it stands now (#361), as the web's `verbs` decides it. A state or
 * standing the server did not give, or one a later server adds, offers every verb, as before it gave them. A report
 * that names no post, comment or author has no action, so none is offered; a closed report is not dismissed.
 */
fun Report.offers(verb: ReportsViewModel.Verb): Boolean =
    if (verb == ReportsViewModel.Verb.Dismiss) {
        state == ReportState.OPEN
    } else {
        action(verb) != null && fitsContent(verb, targetState) && fitsStanding(verb, targetStanding)
    }

/** A content verb fits when the target is in one of its states; a verb about the author never looks at it. */
private fun fitsContent(
    verb: ReportsViewModel.Verb,
    given: TargetState?,
): Boolean {
    val shown =
        when (verb) {
            ReportsViewModel.Verb.Hide -> setOf(TargetState.VISIBLE)
            ReportsViewModel.Verb.Remove -> setOf(TargetState.VISIBLE, TargetState.HIDDEN)
            ReportsViewModel.Verb.Restore -> setOf(TargetState.HIDDEN, TargetState.REMOVED)
            else -> null
        }
    return shown == null || given == null || given == TargetState.UNKNOWN || given in shown
}

/** An author verb fits when the author stands in one of its standings; a verb about content never looks at it. */
private fun fitsStanding(
    verb: ReportsViewModel.Verb,
    given: TargetStanding?,
): Boolean {
    val shown =
        when (verb) {
            ReportsViewModel.Verb.Mute -> setOf(TargetStanding.MEMBER)
            ReportsViewModel.Verb.Unmute -> setOf(TargetStanding.MUTED)
            ReportsViewModel.Verb.Ban ->
                setOf(TargetStanding.MEMBER, TargetStanding.MUTED, TargetStanding.NOT_MEMBER)
            ReportsViewModel.Verb.Unban -> setOf(TargetStanding.BANNED)
            else -> null
        }
    return shown == null || given == null || given == TargetStanding.UNKNOWN || given in shown
}
