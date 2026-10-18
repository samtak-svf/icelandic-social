package samtak.spjall.social

import samtak.spjall.core.Report

/** What [ReportsScreen] can ask for. */
interface ReportsActions {
    fun back()

    fun reason(
        reportId: String,
        text: String,
    )

    fun act(
        report: Report,
        verb: ReportsViewModel.Verb,
    )

    fun retry()
}
