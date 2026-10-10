package samtak.spjall.ui

import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import samtak.spjall.account.FakeAccount
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.Mute
import samtak.spjall.core.Person

/** Whose photo an avatar draws; each is decoded once and kept in memory, and a failure is never kept. */
class PhotosTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount(signedIn = true)
    private val decoded = mutableListOf<String>()

    private fun cache(capacity: Int = 64) =
        PhotoCache(account, dispatcher, capacity) { path ->
            decoded += path
            if (path.endsWith(".webp")) "image of $path" else null
        }

    private val anna = PhotoOf("a2", "v1")

    @Test
    fun aPhotoIsDecodedOnceAndThenKept() =
        runTest(dispatcher) {
            account.photoFiles = mapOf("a2/v1" to "photos/a2/v1.webp")
            val cache = cache()
            assertNull(cache.kept(anna))
            assertEquals("image of photos/a2/v1.webp", cache.load(anna))
            assertEquals("image of photos/a2/v1.webp", cache.kept(anna))
            assertEquals("image of photos/a2/v1.webp", cache.load(anna))
            assertEquals(listOf("photos/a2/v1.webp"), decoded)
            assertEquals(1, account.calls.count { it == "photo a2 v1" })
        }

    @Test
    fun aNewVersionIsFetchedAgain() =
        runTest(dispatcher) {
            account.photoFiles = mapOf("a2/v1" to "a2/v1.webp", "a2/v2" to "a2/v2.webp")
            val cache = cache()
            cache.load(anna)
            assertEquals("image of a2/v2.webp", cache.load(PhotoOf("a2", "v2")))
        }

    @Test
    fun noPhotoAFailureOrABadFileIsNullAndAskedAgainNextTime() =
        runTest(dispatcher) {
            val cache = cache()
            assertNull("the server has none", cache.load(anna))
            account.failOn = "photo a2 v1"
            assertNull("offline", cache.load(anna))
            account.failOn = null
            account.photoFiles = mapOf("a2/v1" to "a2/v1.broken")
            assertNull("not an image", cache.load(anna))
            account.photoFiles = mapOf("a2/v1" to "a2/v1.webp")
            assertEquals("image of a2/v1.webp", cache.load(anna))
        }

    @Test
    fun aOneToOneShowsTheOtherPersonsPhotoAndAGroupItsInitials() {
        val withPhoto = Person("a2", "Anna", true, "v3")
        val without = Person("a3", "Björn", false)

        fun of(vararg members: Person) =
            Conversation("c1", ConversationState.ACTIVE, members.toList(), null, 0u, null, Mute.Off).photoOf()
        assertEquals(PhotoOf("a2", "v3"), of(withPhoto))
        assertNull(of(without))
        assertNull("a group's avatar stays initials (decision 0039)", of(withPhoto, without))
    }

    @Test
    fun onlyTheLastFewAreKept() =
        runTest(dispatcher) {
            account.photoFiles = (1..3).associate { "a$it/v1" to "a$it.webp" }
            val cache = cache(capacity = 2)
            (1..3).forEach { cache.load(PhotoOf("a$it", "v1")) }
            assertNull(cache.kept(PhotoOf("a1", "v1")))
            assertEquals("image of a3.webp", cache.kept(PhotoOf("a3", "v1")))
        }
}
