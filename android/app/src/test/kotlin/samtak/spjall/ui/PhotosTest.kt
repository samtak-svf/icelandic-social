package samtak.spjall.ui

import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import samtak.spjall.account.FakeAccount
import samtak.spjall.core.Author
import samtak.spjall.core.CardCommunity
import samtak.spjall.core.CommunityMember
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.Frame
import samtak.spjall.core.Mute
import samtak.spjall.core.Person
import samtak.spjall.social.FakeSocial
import samtak.spjall.social.community

/** Whose photo an avatar draws; each is decoded once and kept in memory, and a failure is never kept. */
class PhotosTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = FakeAccount(signedIn = true)
    private val social = FakeSocial()
    private val decoded = mutableListOf<String>()

    private fun cache(capacity: Int = 64) =
        PhotoCache(account, social, dispatcher, capacity) { path ->
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
            assertEquals(1, account.calls.count { it == "photoFramed a2 v1 SQUARE" })
        }

    @Test
    fun clearForgetsEveryKeptPhotoAndTheNextLoadFetchesAgain() =
        runTest(dispatcher) {
            account.photoFiles = mapOf("a2/v1" to "a2/v1.webp")
            val cache = cache()
            cache.load(anna)
            assertEquals("image of a2/v1.webp", cache.kept(anna))
            cache.clear()
            assertNull(cache.kept(anna))
            assertEquals("image of a2/v1.webp", cache.load(anna))
            assertEquals(2, decoded.size)
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
            account.failOn = "photoFramed a2 v1 SQUARE"
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
            Conversation(
                "c1",
                ConversationState.ACTIVE,
                null,
                null,
                members.toList(),
                null,
                0u,
                null,
                Mute.Off,
            ).photoOf()
        assertEquals(PhotoOf("a2", "v3"), of(withPhoto))
        assertNull(of(without))
        assertNull("a group's avatar stays initials (decision 0039)", of(withPhoto, without))
    }

    private fun group(
        photo: String?,
        vararg members: Person,
        name: String? = null,
    ) = Conversation("c1", ConversationState.ACTIVE, name, photo, members.toList(), null, 0u, null, Mute.Off)

    @Test
    fun aGroupWithAPhotoShowsItsFileAndAGroupWithoutOneItsInitials() {
        val anna = Person("a2", "Anna", true, "v3")
        val siggi = Person("a3", "Siggi", false)
        val stamp = { _: String -> 7L }
        assertEquals(
            PhotoOf("/media/g1.jpg", "7", PhotoKind.GroupFile),
            group("/media/g1.jpg", anna, siggi).photoOf(stamp),
        )
        assertEquals(
            "a group of one other person is a group once it has a name",
            PhotoOf("/media/g1.jpg", "7", PhotoKind.GroupFile),
            group("/media/g1.jpg", anna, name = "Bókaklúbbur").photoOf(stamp),
        )
        assertNull(group(null, anna, siggi).photoOf(stamp))
        assertEquals("a 1:1 keeps the person's photo (0094)", PhotoOf("a2", "v3"), group(null, anna).photoOf(stamp))
        assertEquals("the core gives a 1:1 no file", PhotoOf("a2", "v3"), group("/media/x.jpg", anna).photoOf(stamp))
    }

    @Test
    fun aGroupFileIsReadFromDiskAndAReplacedOneIsAnotherKey() =
        runTest(dispatcher) {
            val cache = PhotoCache(account, social, dispatcher) { path -> "image of $path".also { decoded += it } }
            val first = PhotoOf("/media/g1.jpg", "1", PhotoKind.GroupFile)
            val replaced = PhotoOf("/media/g1.jpg", "2", PhotoKind.GroupFile)
            assertEquals("image of /media/g1.jpg", cache.load(first))
            assertNull("the replaced file is not served from the old key", cache.kept(replaced))
            cache.load(replaced)
            assertEquals(2, decoded.size)
            assertEquals(emptyList<String>(), account.calls.filter { it.startsWith("photoFramed") })
        }

    @Test
    fun theStampChangesWhenTheCoreRewritesTheFile() {
        val file = java.io.File.createTempFile("group", ".jpg")
        try {
            file.writeBytes(ByteArray(10))
            file.setLastModified(1_000_000L)
            val before = fileStamp(file.path)
            file.writeBytes(ByteArray(11))
            assertNotEquals(before, fileStamp(file.path))
            file.setLastModified(2_000_000L)
            val second = fileStamp(file.path)
            file.setLastModified(3_000_000L)
            assertNotEquals(second, fileStamp(file.path))
        } finally {
            file.delete()
        }
    }

    @Test
    fun eachKindAsksTheCoreForItsOwnFileAndIsKeptByIdAndVersion() =
        runTest(dispatcher) {
            account.photoFiles = mapOf("c1/v1" to "account.webp")
            social.pictureFiles = mapOf("c1/v1" to "picture.webp")
            social.coverFiles = mapOf("c1/v1" to "cover.webp")
            val cache = cache()
            val picture = PhotoOf("c1", "v1", PhotoKind.CommunityPicture)
            val cover = PhotoOf("c1", "v1", PhotoKind.CommunityCover, Frame.COMPACT)
            assertEquals("image of picture.webp", cache.load(picture))
            assertEquals("image of cover.webp", cache.load(cover))
            assertEquals("image of account.webp", cache.load(PhotoOf("c1", "v1")))
            repeat(2) { cache.load(picture) }
            val asked = listOf("communityPictureFramed c1 v1 SQUARE", "communityCoverFramed c1 v1 COMPACT")
            assertEquals(asked, social.calls)
            assertEquals(listOf("photoFramed c1 v1 SQUARE"), account.calls.filter { it.startsWith("photo") })
            assertEquals("image of picture.webp", cache.kept(picture))
            assertNull("a new version is another photo", cache.kept(PhotoOf("c1", "v2", PhotoKind.CommunityPicture)))
        }

    @Test
    fun aCoverIsFetchedAndKeptPerFrame() =
        runTest(dispatcher) {
            social.coverFiles = mapOf("c1/v1" to "cover.webp")
            val cache = cache()
            val compact = PhotoOf("c1", "v1", PhotoKind.CommunityCover, Frame.COMPACT)
            val expanded = compact.copy(frame = Frame.EXPANDED)
            cache.load(compact)
            assertNull("the other frame is another image", cache.kept(expanded))
            cache.load(expanded)
            cache.load(compact)
            val fetched = listOf("communityCoverFramed c1 v1 COMPACT", "communityCoverFramed c1 v1 EXPANDED")
            assertEquals(fetched, social.calls)
        }

    @Test
    fun aCommunityAndAMemberNameTheirImagesByVersion() {
        val community = community("c1").copy(photo = "p3", cover = "k4")
        assertEquals(PhotoOf("c1", "p3", PhotoKind.CommunityPicture), community.pictureOf())
        assertEquals(PhotoOf("c1", "k4", PhotoKind.CommunityCover), community.coverOf())
        assertNull(community("c1").pictureOf())
        assertNull(community("c1").coverOf())
        assertEquals(
            PhotoOf("a2", "v7"),
            CommunityMember("a2", "Anna", true, CommunityRole.MEMBER, 1uL, "v7").photoOf(),
        )
        assertNull(CommunityMember("a3", null, false, CommunityRole.MEMBER, 1uL, null).photoOf())
        assertEquals(PhotoOf("c1", "p1", PhotoKind.CommunityPicture), CardCommunity("c1", "K", "p1").pictureOf())
        assertEquals(PhotoOf("a4", "v2"), Author("a4", "Anna", true, "v2", null).photoOf())
        assertNull(Author("a5", null, false, null, null).photoOf())
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
