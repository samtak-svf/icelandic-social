package samtak.spjall.account

import samtak.spjall.core.CoreException

/**
 * Why an action failed, as far as the person can do something about it. A refusal keeps the
 * server's request id (decision 0037), so a tester can quote it.
 */
sealed interface Problem {
    /** The server's id for the refused request; null when no server refused it. */
    val requestId: String? get() = null

    /** No answer from the server: trying again may work. */
    data object Unreachable : Problem

    /** Kenni verified a person whose kennitala is on another account (decision 0033): trying again cannot help. */
    data class IdentityTaken(
        override val requestId: String? = null,
    ) : Problem

    /** A photo or file over the 25 MB limit (0023): trying again cannot help. */
    data object TooLarge : Problem

    /** Anything else. */
    data class Generic(
        override val requestId: String? = null,
    ) : Problem
}

fun Throwable.problem(): Problem =
    when {
        this is CoreException.Unreachable -> Problem.Unreachable
        this is CoreException.Refused && code == "identity_taken" -> Problem.IdentityTaken(requestId)
        this is CoreException.Refused -> Problem.Generic(requestId)
        else -> Problem.Generic()
    }

/** The server answered 404: the thing asked for does not exist, or no longer does. */
fun Throwable.isNotFound(): Boolean = this is CoreException.Refused && status.toInt() == NOT_FOUND

private const val NOT_FOUND = 404
