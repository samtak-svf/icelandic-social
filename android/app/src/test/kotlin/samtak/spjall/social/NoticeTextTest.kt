package samtak.spjall.social

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import samtak.spjall.brand.R
import samtak.spjall.core.Author
import samtak.spjall.core.NotificationAction
import samtak.spjall.core.SocialNotice
import samtak.spjall.core.SocialNotificationKind

/** The finished sentence of a notice: the arguments reach the brand's string, a deleted account has its word. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NoticeTextTest {
    private val resources = ApplicationProvider.getApplicationContext<Context>().resources

    private fun text(
        kind: SocialNotificationKind,
        vararg names: String?,
        count: Int = names.size,
    ) = noticeLine(kind, names.toList(), count.toLong()).text(resources)

    @Test
    fun aDeclinedAnonymousPostHasItsOwnSentence() {
        val declined =
            noticeLine(SocialNotificationKind.MODERATED, emptyList(), 0, NotificationAction.DECLINE_ANONYMOUS_POST)
        assertEquals("Stjórnandi hafnaði nafnlausri færslu frá þér.", declined.text(resources))
        assertEquals(NoticeBadge.MODERATOR, declined.badge)
        val other = noticeLine(SocialNotificationKind.MODERATED, emptyList(), 0, NotificationAction.HIDE_POST)
        assertEquals(noticeLine(SocialNotificationKind.MODERATED, emptyList(), 0).key, other.key)
    }

    @Test
    fun aReviewAndAClearedPhotoHaveTheirOwnSentences() {
        fun line(action: NotificationAction?) =
            noticeLine(SocialNotificationKind.MODERATED, emptyList(), 0, action).text(resources)
        assertEquals(resources.getString(R.string.notice_review_upheld), line(NotificationAction.REVIEW_UPHELD))
        assertEquals(resources.getString(R.string.notice_review_overturned), line(NotificationAction.REVIEW_OVERTURNED))
        assertEquals(
            resources.getString(R.string.notice_account_photo_cleared),
            line(NotificationAction.CLEAR_ACCOUNT_PHOTO),
        )
        assertEquals(resources.getString(R.string.notice_moderated), line(NotificationAction.REMOVE_POST))
    }

    @Test
    fun oneActorReadsPlain() {
        assertEquals("Anna skrifaði athugasemd við póstinn þinn.", text(SocialNotificationKind.COMMENT, "Anna"))
    }

    @Test
    fun twoActorsNameTheNewestAndTheOther() {
        assertEquals(
            "Anna og Garðar svöruðu athugasemdinni þinni.",
            text(SocialNotificationKind.REPLY, "Anna", "Garðar"),
        )
    }

    @Test
    fun threeOrMoreCountTheOthersWithTheirPlural() {
        assertEquals(
            "Anna og 2 aðrir skrifuðu athugasemdir við póstinn þinn.",
            text(SocialNotificationKind.COMMENT, "Anna", "Garðar", "Þórdís", count = 3),
        )
    }

    @Test
    fun aDeletedAccountReadsAsThePersonDeleted() {
        assertEquals(
            "Eyddur reikningur skrifaði athugasemd við póstinn þinn.",
            text(SocialNotificationKind.COMMENT, null),
        )
        assertEquals(
            "Eyddur reikningur og Anna svöruðu athugasemdinni þinni.",
            text(SocialNotificationKind.REPLY, null, "Anna"),
        )
    }

    @Test
    fun anOldServerWithOnlyTheNewestActorStillNamesIt() {
        val line = notification("n", SocialNotificationKind.COMMENT, 1uL).line()
        assertEquals("Anna skrifaði athugasemd við póstinn þinn.", line.text(resources))
        val withActors =
            notification("n", SocialNotificationKind.COMMENT, 1uL).copy(actors = listOf(Author("a9", "Eva", true)))
        assertEquals("Eva skrifaði athugasemd við póstinn þinn.", withActors.line().text(resources))
    }

    @Test
    fun aNoticeTheDeviceAnnouncesSaysWhatItsRowSays() {
        val actors = listOf(Author("a2", "Anna", false), Author("a3", "Garðar", false))
        val row = notification("n1", SocialNotificationKind.REACTION, 10uL).copy(actors = actors, actorCount = 2uL)
        val notice =
            SocialNotice(
                row.notificationId,
                row.kind,
                actors,
                2uL,
                row.communityId,
                row.postId,
                null,
                null,
                null,
                row.createdAt,
            )
        assertEquals(row.line().text(resources), notice.line().text(resources))
    }
}
