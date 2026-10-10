package samtak.spjall.push

import org.junit.Assert.assertEquals
import org.junit.Test
import samtak.spjall.account.FakeAccount
import samtak.spjall.account.unreachable
import samtak.spjall.core.Notice
import samtak.spjall.core.NoticeKind
import samtak.spjall.core.Notices
import samtak.spjall.core.Person

class PushTest {
    private val anna = Person("a2", "Anna Sigurðardóttir", true)
    private val unnamed = Person("a3", null, false)
    private val labels =
        Labels(unnamed = "Ónefnd", alone = "Bara þú", photo = "Mynd", file = "Skrá", post = "Deild færsla")

    private val account = FakeAccount(signedIn = true)
    private val notifier = ListNotifier()
    private var foreground = false
    private val push = Push(account, notifier, { labels }, { foreground })

    private fun notice(
        conversation: String,
        seq: ULong,
        sender: Person = anna,
        kind: NoticeKind = NoticeKind.TEXT,
        text: String? = "hæ",
        members: List<Person> = listOf(sender),
    ) = Notice(conversation, members, seq, sender, kind, text, 1_700_000_000_000uL + seq)

    @Test
    fun aPushSyncsThenAnnouncesEachConversationOnce() {
        account.notices =
            Notices(
                listOf(notice("c1", 4u), notice("c2", 9u, text = "halló"), notice("c1", 5u, text = "ertu þarna?")),
                cleared = listOf("c3"),
            )

        push.wake()

        assertEquals(listOf("sync", "notices"), account.calls)
        assertEquals(listOf("fallback false", "cancel [c3]"), notifier.calls)
        assertEquals(
            listOf(
                Announcement(
                    "c1",
                    "Anna Sigurðardóttir",
                    group = false,
                    lines =
                        listOf(
                            Line("Anna Sigurðardóttir", "hæ", 1_700_000_000_004L),
                            Line("Anna Sigurðardóttir", "ertu þarna?", 1_700_000_000_005L),
                        ),
                ),
                Announcement(
                    "c2",
                    "Anna Sigurðardóttir",
                    group = false,
                    lines = listOf(Line("Anna Sigurðardóttir", "halló", 1_700_000_000_009L)),
                ),
            ),
            notifier.shown,
        )
    }

    @Test
    fun aSharedPostIsAnnouncedInAFixedSentenceAndNeverByItsText() {
        account.notices =
            Notices(
                listOf(
                    notice("c1", 1u, kind = NoticeKind.POST, text = null),
                    // The core gives none; a text that did come is still not shown (decision 0040).
                    notice("c1", 2u, kind = NoticeKind.POST, text = "leyndó"),
                ),
                cleared = emptyList(),
            )

        push.wake()

        assertEquals(
            listOf("Deild færsla", "Deild færsla"),
            notifier.shown
                .single()
                .lines
                .map { it.text },
        )
    }

    @Test
    fun aGroupIsTitledByItsMembersAndAFileWithoutACaptionSaysWhatItIs() {
        account.notices =
            Notices(
                listOf(
                    notice("g", 1u, kind = NoticeKind.PHOTO, text = null, members = listOf(anna, unnamed)),
                    notice(
                        "g",
                        2u,
                        sender = unnamed,
                        kind = NoticeKind.FILE,
                        text = null,
                        members = listOf(anna, unnamed),
                    ),
                    notice("g", 3u, kind = NoticeKind.PHOTO, text = "útsýnið", members = listOf(anna, unnamed)),
                    notice("alone", 1u, members = emptyList()),
                ),
                cleared = emptyList(),
            )

        push.wake()

        val (group, alone) = notifier.shown
        assertEquals("Anna Sigurðardóttir, Ónefnd", group.title)
        assertEquals(true, group.group)
        assertEquals(
            listOf("Anna Sigurðardóttir: Mynd", "Ónefnd: Skrá", "Anna Sigurðardóttir: útsýnið"),
            group.lines.map { "${it.sender}: ${it.text}" },
        )
        assertEquals("Bara þú", alone.title)
    }

    @Test
    fun aFailedSyncSaysOnlyThatSomethingArrived() {
        account.failNext = unreachable()

        push.wake()

        assertEquals(listOf("sync"), account.calls)
        assertEquals(listOf("fallback true"), notifier.calls)

        // The next push that gets through takes the fallback away.
        push.wake()
        assertEquals(listOf("fallback true", "fallback false", "cancel []"), notifier.calls)
    }

    @Test
    fun inTheForegroundNothingIsAnnouncedButWhatWasReadIsTakenAway() {
        foreground = true
        account.notices = Notices(listOf(notice("c1", 4u)), cleared = listOf("c2"))

        push.wake()

        assertEquals(listOf("sync", "notices"), account.calls)
        assertEquals(listOf("fallback false", "cancel [c2]"), notifier.calls)

        account.failNext = unreachable()
        push.wake()
        assertEquals(listOf("fallback false", "cancel [c2]"), notifier.calls)
    }

    @Test
    fun quietCountsWhatIsOnScreenAsShownWithoutSyncing() {
        account.notices = Notices(listOf(notice("c1", 4u)), cleared = listOf("c2"))

        push.quiet()

        assertEquals(listOf("notices"), account.calls)
        assertEquals(listOf("fallback false", "cancel [c2]"), notifier.calls)
        // The core gives each notice once: a push after it has nothing to show.
        push.wake()
        assertEquals(emptyList<Announcement>(), notifier.shown)
    }

    @Test
    fun aTokenIsKeptAndSyncedEvenWhenTheSyncFails() {
        push.token("fcm-1")
        assertEquals(listOf("setPushToken fcm-1 false", "sync"), account.calls)

        account.failNext = unreachable()
        push.token("fcm-2")
        assertEquals(listOf("setPushToken fcm-1 false", "sync", "setPushToken fcm-2 false"), account.calls)
    }

    private class ListNotifier : Notifier {
        val calls = mutableListOf<String>()
        val shown = mutableListOf<Announcement>()

        override fun show(announcements: List<Announcement>) {
            shown += announcements
        }

        override fun cancel(conversations: List<String>) {
            calls += "cancel $conversations"
        }

        override fun fallback(shown: Boolean) {
            calls += "fallback $shown"
        }
    }
}
