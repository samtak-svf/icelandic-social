package samtak.spjall.social

import android.content.res.Resources
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import samtak.spjall.brand.R
import samtak.spjall.core.SocialNotice
import samtak.spjall.core.SocialNotification
import samtak.spjall.core.SocialNotificationKind

/** The mark on the corner of a notification's picture (decisions 0103, 0104). */
enum class NoticeBadge { EMOJI, COMMENT, APPROVED, MODERATOR }

/**
 * The sentence of a notification row and of its push, and the badge, chosen by the rule in
 * api/presentation.vectors.json that the web and iOS follow: one actor reads plain, two read `_two`, three or
 * more read `_many` with the others counted. [name] and [other] are nullable: null is a deleted account.
 * Resolve it with [text]; the row and the push both do, so they say the same thing.
 */
data class NoticeLine(
    /** A string, or a plural when [plural]. */
    val key: Int,
    val plural: Boolean,
    val name: String?,
    val other: String?,
    /** How many others the sentence counts; only `_many` reads it. */
    val count: Int,
    val badge: NoticeBadge,
)

private class Stem(
    @StringRes val one: Int,
    @StringRes val two: Int,
    @PluralsRes val many: Int,
)

private val COMMENT = Stem(R.string.notice_comment, R.string.notice_comment_two, R.plurals.notice_comment_many)
private val REPLY = Stem(R.string.notice_reply, R.string.notice_reply_two, R.plurals.notice_reply_many)
private val REACTION = Stem(R.string.notice_reaction, R.string.notice_reaction_two, R.plurals.notice_reaction_many)

/**
 * The line of a notification from its kind and newest actors (null for a deleted account). A moderator's action
 * changes no sentence here: the vector for `decline_anonymous_post` is the web's alone, since that string is
 * not on Android's surface (brand/strings.contract.json) and the core has no such action.
 */
fun noticeLine(
    kind: SocialNotificationKind,
    names: List<String?>,
    actorCount: Long,
): NoticeLine {
    val stem =
        when (kind) {
            SocialNotificationKind.JOIN_APPROVED ->
                return fixed(R.string.notice_join_approved, NoticeBadge.APPROVED)
            SocialNotificationKind.MODERATED -> return fixed(R.string.notice_moderated, NoticeBadge.MODERATOR)
            SocialNotificationKind.COMMENT -> COMMENT
            SocialNotificationKind.REPLY -> REPLY
            SocialNotificationKind.REACTION -> REACTION
        }
    val badge = if (kind == SocialNotificationKind.REACTION) NoticeBadge.EMOJI else NoticeBadge.COMMENT
    val name = names.firstOrNull()
    return when {
        actorCount >= MANY -> NoticeLine(stem.many, true, name, null, (actorCount - 1).toInt(), badge)
        actorCount == 2L -> NoticeLine(stem.two, false, name, names.getOrNull(1), 0, badge)
        else -> NoticeLine(stem.one, false, name, null, 0, badge)
    }
}

private fun fixed(
    @StringRes key: Int,
    badge: NoticeBadge,
) = NoticeLine(key, false, null, null, 0, badge)

/** A server before 0103 sends no `actors`, only the newest `actor`. */
fun SocialNotification.line(): NoticeLine =
    noticeLine(
        kind,
        if (actors.isEmpty()) listOfNotNull(actor).map { it.name } else actors.map { it.name },
        actorCount.toLong(),
    )

/** The line of a notice the device announces; the same rule as [SocialNotification.line]. */
fun SocialNotice.line(): NoticeLine = noticeLine(kind, actors.map { it.name }, actorCount.toLong())

/** The finished sentence. */
fun NoticeLine.text(resources: Resources): String {
    val deleted = resources.getString(R.string.person_deleted)
    val first = name ?: deleted
    return when {
        plural -> resources.getQuantityString(key, count, first, count)
        other != null || key in TWO -> resources.getString(key, first, other ?: deleted)
        else -> resources.getString(key, first)
    }
}

private val TWO = setOf(R.string.notice_comment_two, R.string.notice_reply_two, R.string.notice_reaction_two)

private const val MANY = 3L
