package samtak.spjall.social

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The poll cases in api/poll.vectors.json, which the server, the core, the web and iOS read too. */
class PollRuleVectorsTest {
    private val cases =
        checkNotNull(javaClass.classLoader?.getResourceAsStream("poll.vectors.json")) {
            "poll.vectors.json is not on the test classpath"
        }.use { Json.parseToJsonElement(it.readBytes().decodeToString()).jsonObject }
            .getValue("cases")
            .jsonArray

    @Test
    fun theStandInFollowsEveryCase() {
        assertTrue(cases.isNotEmpty())
        cases.map { it.jsonObject }.forEach { case ->
            assertEquals(
                case.getValue("note").jsonPrimitive.content,
                case.getValue("valid").jsonPrimitive.boolean,
                FakePollRule.valid(
                    case.getValue("question").jsonPrimitive.content,
                    case.getValue("options").jsonArray.map { it.jsonPrimitive.content },
                ),
            )
        }
    }

    @Test
    fun aFieldHoldsAnOptionUpToTheLimitInCodePoints() {
        val poll = PollDraft.empty()
        val full = "\uD83D\uDE00".repeat(PollDraft.OPTION_MAX)
        assertEquals(full, PollDraft.withOption(poll, 0, full)[0])
        assertEquals(poll, PollDraft.withOption(poll, 0, full + "a"))
    }
}
