package samtak.spjall.frames

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import samtak.spjall.conversations.SCREENSHOT_DEVICE
import samtak.spjall.conversations.SCREENSHOT_SDK
import samtak.spjall.core.FrameKind
import samtak.spjall.ui.SpjallTheme

/** The crop sheet (decision 0086), compared with the images in src/test/screenshots/. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [SCREENSHOT_SDK], qualifiers = SCREENSHOT_DEVICE, fontScale = 1f)
class FrameSheetScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private fun shoot(
        kind: FrameKind,
        widthDp: Int,
        advanced: Boolean = false,
    ) {
        compose.setContent {
            SpjallTheme {
                FrameSheetContent(
                    kind = kind,
                    image = bandedImage(),
                    base = null,
                    widthDp = widthDp,
                    onSave = {},
                    onCancel = {},
                    rules = FakeFrameRules,
                    initiallyAdvanced = advanced,
                )
            }
        }
        compose.onRoot().captureRoboImage()
    }

    @Test
    fun coverDefault() = shoot(FrameKind.COVER, widthDp = 411)

    @Test
    fun photoDefault() = shoot(FrameKind.PHOTO, widthDp = 411)

    @Test
    fun advancedAtCompactWidth() = shoot(FrameKind.COVER, widthDp = 411, advanced = true)

    @Test
    @Config(qualifiers = "w900dp-h900dp")
    fun advancedAtExpandedWidth() = shoot(FrameKind.COVER, widthDp = 900, advanced = true)
}
