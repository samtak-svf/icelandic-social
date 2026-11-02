package samtak.spjall.base

import samtak.spjall.account.Problem

/**
 * What a [BaseViewModel] holds about a screen: whether one thing is on its way ([busy]), why the last one
 * failed ([problem]) and whether the screen has answered at all ([answered]). Each screen's own state names
 * itself in these three terms, so the view model's one [BaseViewModel.perform] writes all of them.
 */
interface ScreenState<S : ScreenState<S>> {
    val busy: Boolean
    val problem: Problem?

    /** The same state, [busy] or not. */
    fun busy(on: Boolean): S

    /** The same state, showing [problem], or nothing. */
    fun trouble(problem: Problem?): S

    /** The same state, the screen answered: a failure says so too, so the empty screen is not a wait. */
    fun answered(): S
}
