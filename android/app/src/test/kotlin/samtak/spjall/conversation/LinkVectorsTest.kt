package samtak.spjall.conversation

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The links iOS finds too, read from api/link.vectors.json. The core's test holds where each one goes. */
class LinkVectorsTest {
    @Test
    fun everyLinkIsFoundAndOpensAsTheVectorsSay() {
        val vectors =
            checkNotNull(javaClass.classLoader?.getResourceAsStream("link.vectors.json")) {
                "link.vectors.json is not on the test classpath"
            }.use { Json.parseToJsonElement(it.readBytes().decodeToString()).jsonObject }
        val cases = vectors.getValue("cases").jsonArray.map { it.jsonObject }
        assertTrue(cases.isNotEmpty())
        for (case in cases) {
            val text = case.getValue("text").jsonPrimitive.content
            val want =
                case.getValue("links").jsonArray.map { it.jsonObject }.map {
                    it.getValue("written").jsonPrimitive.content to it.getValue("opens").jsonPrimitive.content
                }
            val found = links(text).map { it.written(text) to it.url }
            assertEquals(case.getValue("note").jsonPrimitive.content, want, found)
        }
    }
}
