package samtak.spjall.social

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URI

/** What a person shares, read from api/link.vectors.json. The core's test reads each one back to its target. */
class SocialLinksTest {
    @Test
    fun everyAddressIsMintedAsTheVectorsSay() {
        val vectors =
            checkNotNull(javaClass.classLoader?.getResourceAsStream("link.vectors.json")) {
                "link.vectors.json is not on the test classpath"
            }.use { Json.parseToJsonElement(it.readBytes().decodeToString()).jsonObject }
        val minted = vectors.getValue("minted").jsonArray.map { it.jsonObject }
        assertTrue(minted.isNotEmpty())
        for (vector in minted) {
            val address = vector.getValue("address").jsonPrimitive.content
            val id = vector.getValue("id").jsonPrimitive.content
            val origin = URI(address).let { "${it.scheme}://${it.host}" }
            val got =
                when (val kind = vector.getValue("kind").jsonPrimitive.content) {
                    "post" -> SocialLinks.post(id, origin)
                    "community" -> SocialLinks.community(id, origin)
                    else -> error("$kind is no screen")
                }
            assertEquals(address, got)
        }
    }
}
