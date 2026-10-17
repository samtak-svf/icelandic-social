package samtak.spjall.account

import samtak.spjall.core.CoreException

/**
 * Why an action failed, as far as the person can do something about it. A refusal keeps the
 * server's request id (decision 0037), and a failure no server answered the core's code for it
 * (decision 0049), so a tester can quote either.
 */
sealed interface Problem {
    /** The server's id for the refused request; null when no server refused it. */
    val requestId: String? get() = null

    /** The core's code for a failure no server answered (0049); null for a refusal or no code. */
    val code: String? get() = null

    /** No answer from the server: trying again may work. */
    data object Unreachable : Problem

    /** Kenni verified a person whose kennitala is on another account (decision 0033): trying again cannot help. */
    data class IdentityTaken(
        override val requestId: String? = null,
    ) : Problem

    /** A photo or file over the 25 MB limit (0023): trying again cannot help. */
    data object TooLarge : Problem

    /** No fix came for a location (0059): location may be off on the phone. */
    data object LocationNotFound : Problem

    /** The person refused the app their location (0059): only the phone's settings can change it. */
    data object LocationDenied : Problem

    /** Anything else. */
    data class Generic(
        override val requestId: String? = null,
        override val code: String? = null,
    ) : Problem
}

fun Throwable.problem(): Problem =
    when {
        this is CoreException.Unreachable -> Problem.Unreachable
        this is CoreException.Refused && code == "identity_taken" -> Problem.IdentityTaken(requestId)
        this is CoreException.Refused -> Problem.Generic(requestId)
        this is CoreException -> Problem.Generic(code = localCode())
        else -> Problem.Generic()
    }

/**
 * The core makes the code (0049). A JVM unit test has no native core and a fake account throws
 * its errors there, so a code that cannot be asked for is none.
 */
private fun CoreException.localCode(): String? = runCatching { code() }.getOrNull()

/** The server answered 404: the thing asked for does not exist, or no longer does. */
fun Throwable.isNotFound(): Boolean = this is CoreException.Refused && status.toInt() == NOT_FOUND

private const val NOT_FOUND = 404
