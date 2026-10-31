package samtak.spjall.social

import samtak.spjall.core.Community
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.Poll
import samtak.spjall.core.PollOption
import samtak.spjall.core.Post
import samtak.spjall.core.PostTarget
import samtak.spjall.core.WallAudience
import java.lang.reflect.Proxy

/** A mute that has not ended. */
internal val MUTED_FOR_GOOD = ULong.MAX_VALUE / 2uL

/** An open poll of two options. */
internal fun feedPoll() = Poll(listOf(PollOption("o0", "Já", 0uL), PollOption("o1", "Nei", 0uL)), 0uL, null, false)

/** The feed with [posts] from [mine], whose [offered] ones the composer lists. */
internal fun feedState(
    posts: List<Post> = emptyList(),
    mine: List<Community> = emptyList(),
    offered: List<Community> = mine,
    target: PostTarget = PostTarget.Wall(WallAudience.FRIENDS),
    composing: Boolean = false,
) = FeedViewModel.State(
    posts = posts,
    loaded = true,
    communities = offered,
    mine = mine,
    target = target,
    composing = composing,
)

internal fun memberOf(
    id: String,
    mutedUntil: ULong? = null,
    anonymousPosts: Boolean = false,
    role: CommunityRole = CommunityRole.MEMBER,
) = community(id, role = role, mutedUntil = mutedUntil, anonymousPosts = anonymousPosts)

/** Every call on the interface, as `name arg arg`, in [calls]; nothing is returned. */
internal inline fun <reified T> recording(calls: MutableList<String>): T =
    Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { self, method, args ->
        when (method.name) {
            "equals" -> self === args?.firstOrNull()
            "hashCode" -> System.identityHashCode(self)
            "toString" -> "recording"
            else -> {
                calls += (listOf(method.name) + (args?.map { it.toString() } ?: emptyList())).joinToString(" ")
                null
            }
        }
    } as T
