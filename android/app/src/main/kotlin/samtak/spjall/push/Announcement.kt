package samtak.spjall.push

import samtak.spjall.core.Notice
import samtak.spjall.core.NoticeKind
import samtak.spjall.core.Person

/** The brand's words a notification needs, read from resources once per push. */
data class Labels(
    val unnamed: String,
    val alone: String,
    val photo: String,
    val file: String,
    /** A shared Fljótið post: fixed, never its text or author (decision 0040). */
    val post: String,
)

/** One conversation's notification: its title, and the messages to add to it, oldest first. */
data class Announcement(
    val conversation: String,
    val title: String,
    val group: Boolean,
    val lines: List<Line>,
)

data class Line(
    val sender: String,
    val text: String,
    val ts: Long,
)

/**
 * The core's notices as one announcement per conversation (decision 0025),
 * in the order the core gave them. The title is the newest notice's members,
 * as the conversation list titles it.
 */
fun announcements(
    shown: List<Notice>,
    labels: Labels,
): List<Announcement> =
    shown.groupBy { it.conversation }.map { (conversation, notices) ->
        val members = notices.last().members
        Announcement(
            conversation = conversation,
            title = if (members.isEmpty()) labels.alone else members.joinToString(", ") { it.named(labels) },
            group = members.size > 1,
            lines = notices.sortedBy { it.seq }.map { Line(it.sender.named(labels), it.words(labels), it.ts.toLong()) },
        )
    }

private fun Person.named(labels: Labels) = name ?: labels.unnamed

/** A photo or file says what it is unless it has a caption; a shared post only that it is one. */
private fun Notice.words(labels: Labels) =
    when (kind) {
        NoticeKind.TEXT -> text.orEmpty()
        NoticeKind.PHOTO -> text ?: labels.photo
        NoticeKind.FILE -> text ?: labels.file
        NoticeKind.POST -> labels.post
    }
