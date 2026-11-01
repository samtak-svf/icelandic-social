package samtak.spjall.ui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The count every platform shares, read from api/text-length.vectors.json. */
class TextLimitVectorsTest {
    private val vectors =
        checkNotNull(javaClass.classLoader?.getResourceAsStream("text-length.vectors.json")) {
            "text-length.vectors.json is not on the test classpath"
        }.use { Json.parseToJsonElement(it.readBytes().decodeToString()).jsonObject }

    @Test
    fun everyTextCountsAsTheVectorsSay() {
        val cases = vectors.getValue("lengths").jsonArray.map { it.jsonObject }
        assertTrue(cases.isNotEmpty())
        for (case in cases) {
            val text = case.getValue("text").jsonPrimitive.content
            assertEquals(
                case.getValue("note").jsonPrimitive.content,
                case.getValue("codePoints").jsonPrimitive.int,
                text.textLength(),
            )
        }
    }

    @Test
    fun everyTextClipsAsTheVectorsSay() {
        val cases = vectors.getValue("clips").jsonArray.map { it.jsonObject }
        assertTrue(cases.isNotEmpty())
        for (case in cases) {
            val text = case.getValue("text").jsonPrimitive.content
            assertEquals(
                case.getValue("note").jsonPrimitive.content,
                case.getValue("clipped").jsonPrimitive.content,
                text.clippedTo(case.getValue("limit").jsonPrimitive.int),
            )
        }
    }
}
