package samtak.spjall.account

import samtak.spjall.core.CoreException

/** Why an action failed, as far as the person can do something about it. */
enum class Problem {
    /** No answer from the server: trying again may work. */
    Unreachable,

    /** Kenni signed the person in, but there is no account and no live invite. */
    InviteRequired,

    /** Anything else. */
    Generic,
}

fun Throwable.problem(): Problem =
    when {
        this is CoreException.Unreachable -> Problem.Unreachable
        this is CoreException.Refused && code == "invite_required" -> Problem.InviteRequired
        else -> Problem.Generic
    }

/** The server answered 404: the thing asked for does not exist, or no longer does. */
fun Throwable.isNotFound(): Boolean = this is CoreException.Refused && status.toInt() == NOT_FOUND

private const val NOT_FOUND = 404
