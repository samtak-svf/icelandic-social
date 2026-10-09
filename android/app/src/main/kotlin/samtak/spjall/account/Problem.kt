package samtak.spjall.account

import samtak.spjall.core.CoreException

/** Why an action failed, as far as the person can do something about it. */
enum class Problem {
    /** No answer from the server: trying again may work. */
    Unreachable,

    /** Kenni verified a person whose kennitala is on another account (decision 0033): trying again cannot help. */
    IdentityTaken,

    /** A photo or file over the 25 MB limit (0023): trying again cannot help. */
    TooLarge,

    /** Anything else. */
    Generic,
}

fun Throwable.problem(): Problem =
    when {
        this is CoreException.Unreachable -> Problem.Unreachable
        this is CoreException.Refused && code == "identity_taken" -> Problem.IdentityTaken
        else -> Problem.Generic
    }

/** The server answered 404: the thing asked for does not exist, or no longer does. */
fun Throwable.isNotFound(): Boolean = this is CoreException.Refused && status.toInt() == NOT_FOUND

private const val NOT_FOUND = 404
