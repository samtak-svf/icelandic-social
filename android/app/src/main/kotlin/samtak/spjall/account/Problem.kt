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

    /** The person refused the app the camera (#323): only the phone's settings can change it. */
    data object CameraDenied : Problem

    /** Refused as not this account's to do (`not_permitted`, #362): trying again cannot help. */
    data object NotPermitted : Problem

    /** What was asked for is gone (`not_found`, #362): trying again cannot help. */
    data object NotFound : Problem

    /** A moderator declined this account's join request, which it may repeat after 30 days (`join_declined`). */
    data object JoinDeclined : Problem

    /** The poll was closed while this account voted (`poll_closed`, 0090): trying again cannot help. */
    data object PollClosed : Problem

    /** Three posts are already featured (`pin_limit`, 0088): unpin one first, trying again cannot help. */
    data object PinFull : Problem

    /** A platform moderator holds this account's writing (`suspended`, 0115): trying again cannot help. */
    data object Suspended : Problem

    /** The other account will not take this friend request (`request_refused`, 0114): trying again cannot help. */
    data object RequestRefused : Problem

    /** Too many requests today (`request_limit`, 0114): tomorrow may work. */
    data object RequestLimit : Problem

    /** One of the two has the most friends there may be (`friend_limit`, 0114). */
    data object FriendLimit : Problem

    /** The community stopped allowing anonymous posts meanwhile (`anonymous_off`, 0091). */
    data object AnonymousOff : Problem

    /** The picked image could not be read for a group photo (0094): trying the same file again cannot help. */
    data object GroupPhotoUnsupported : Problem

    /** A group photo could not be set or removed (0094). */
    data object GroupPhotoFailed : Problem

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
        this is CoreException.Refused -> REFUSALS[code] ?: Problem.Generic(requestId)
        this is CoreException -> Problem.Generic(code = localCode())
        else -> Problem.Generic()
    }

/** The refusals that carry no request id of their own: the server's code, and what it means to the reader. */
private val REFUSALS: Map<String?, Problem> =
    mapOf(
        "not_permitted" to Problem.NotPermitted,
        "not_found" to Problem.NotFound,
        "join_declined" to Problem.JoinDeclined,
        "poll_closed" to Problem.PollClosed,
        "anonymous_off" to Problem.AnonymousOff,
        "pin_limit" to Problem.PinFull,
        "suspended" to Problem.Suspended,
        "request_refused" to Problem.RequestRefused,
        "request_limit" to Problem.RequestLimit,
        "friend_limit" to Problem.FriendLimit,
    )

/**
 * The core makes the code (0049). A JVM unit test has no native core and a fake account throws
 * its errors there, so a code that cannot be asked for is none.
 */
private fun CoreException.localCode(): String? = runCatching { code() }.getOrNull()

/** The server answered 404: the thing asked for does not exist, or no longer does. */
fun Throwable.isNotFound(): Boolean = this is CoreException.Refused && status.toInt() == NOT_FOUND

private const val NOT_FOUND = 404
