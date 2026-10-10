package samtak.spjall.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.core.Person

/** The avatar draws a person's photo, and their initials whenever there is none to draw (decision 0039). */
@RunWith(AndroidJUnit4::class)
class AvatarTest {
    @get:Rule val compose = createComposeRule()

    private val asked = mutableListOf<PhotoOf>()

    private fun photos(
        image: ImageBitmap?,
        until: CompletableDeferred<Unit>? = null,
    ) = object : Photos {
        override fun kept(photo: PhotoOf): ImageBitmap? = null

        override suspend fun load(photo: PhotoOf): ImageBitmap? {
            asked += photo
            until?.await()
            return image
        }
    }

    private fun show(
        person: Person,
        photos: Photos?,
    ) = compose.setContent {
        SpjallTheme { CompositionLocalProvider(LocalPhotos provides photos) { Avatar(person) } }
    }

    @Test
    fun aPersonWithAPhotoIsDrawnWithIt() {
        show(Person("a2", "Anna Jónsdóttir", true, "v3"), photos(ImageBitmap(4, 4)))
        compose.onNodeWithTag(AVATAR_PHOTO).assertExists()
        assertEquals(listOf(PhotoOf("a2", "v3")), asked)
    }

    @Test
    fun theInitialsShowWhileThePhotoLoads() {
        val until = CompletableDeferred<Unit>()
        show(Person("a2", "Anna Jónsdóttir", true, "v3"), photos(ImageBitmap(4, 4), until))
        compose.onNodeWithTag(AVATAR_INITIALS).assertExists()
        until.complete(Unit)
        compose.waitUntil { compose.onAllNodes(hasTestTag(AVATAR_PHOTO)).fetchSemanticsNodes().isNotEmpty() }
    }

    @Test
    fun aPhotoThatCannotBeHadLeavesTheInitials() {
        show(Person("a2", "Anna Jónsdóttir", true, "v3"), photos(null))
        compose.waitForIdle()
        compose.onNodeWithTag(AVATAR_INITIALS).assertExists()
    }

    @Test
    fun noPhotoIsNotAskedFor() {
        show(Person("a2", "Anna Jónsdóttir", false), photos(ImageBitmap(4, 4)))
        compose.onNodeWithTag(AVATAR_INITIALS).assertExists()
        assertEquals(emptyList<PhotoOf>(), asked)
    }

    @Test
    fun withoutAPhotoSourceItIsInitials() {
        show(Person("a2", "Anna Jónsdóttir", true, "v3"), null)
        compose.onNodeWithTag(AVATAR_INITIALS).assertExists()
    }
}
