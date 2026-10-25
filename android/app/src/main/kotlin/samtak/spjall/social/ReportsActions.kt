package samtak.spjall.social

import samtak.spjall.core.Report
import samtak.spjall.core.ReportState

/** What [ReportsScreen] can ask for. */
interface ReportsActions {
    fun back()

    /** Shows the open reports, or the closed ones. */
    fun show(state: ReportState)

    fun reason(
        reportId: String,
        text: String,
    )

    fun act(
        report: Report,
        verb: ReportsViewModel.Verb,
    )

    /** Mutes the author of what [report] names for [period]. */
    fun mute(
        report: Report,
        period: ReportsViewModel.MutePeriod,
    )

    /** Asks for the author of the anonymous post a report names, once the moderator confirmed. */
    fun revealAuthor(postId: String)

    fun retry()
}
