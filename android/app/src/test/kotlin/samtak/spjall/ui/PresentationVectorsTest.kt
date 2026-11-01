package samtak.spjall.ui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import samtak.spjall.account.problem
import samtak.spjall.brand.R
import samtak.spjall.core.CoreException
import samtak.spjall.core.NotificationAction
import samtak.spjall.core.SocialNotificationKind
import samtak.spjall.social.NoticeBadge
import samtak.spjall.social.ago
import samtak.spjall.social.label
import samtak.spjall.social.monthName
import samtak.spjall.social.noticeLine
import java.time.Instant

/**
 * The rules the web and iOS share, read from api/presentation.vectors.json (#275). A rule that drifts on
 * one platform fails here, or there.
 */
class PresentationVectorsTest {
    @get:Rule
    val zone = IcelandZone()

    private val vectors: JsonObject =
        checkNotNull(javaClass.classLoader?.getResourceAsStream("presentation.vectors.json")) {
            "presentation.vectors.json is not on the test classpath"
        }.use { Json.parseToJsonElement(it.readBytes().decodeToString()).jsonObject }

    private fun cases(section: String): JsonArray =
        vectors.getValue(section).jsonArray.also { assertTrue(it.isNotEmpty()) }

    private fun JsonObject.text(field: String) = getValue(field).jsonPrimitive.content

    private fun JsonObject.millis(field: String) = Instant.parse(text(field)).toEpochMilli()

    /** The id of the brand string a vector names. */
    private fun stringId(key: String): Int = R.string::class.java.getField(key).getInt(null)

    @Test
    fun relativeTimeChoosesTheStringAndCountOfEveryVector() {
        for (case in cases("relativeTime").map { it.jsonObject }) {
            val where = "${case.text("at")} from ${case.text("now")}"
            val millis = case.millis("at")
            val ago = ago(millis, case.millis("now"))
            val key = case.getValue("key")
            if (key is JsonNull) {
                assertEquals(where, null, ago.unit.label())
                assertEquals(where, case.text("expected"), calendarDate(millis.toULong()))
            } else {
                assertEquals(where, stringId(key.jsonPrimitive.content), ago.unit.label())
                case["count"]?.let { assertEquals(where, it.jsonPrimitive.int.toLong(), ago.count) }
            }
        }
    }

    @Test
    fun initialsFollowEveryVector() {
        for (case in cases("initials").map { it.jsonObject }) {
            val name = case.getValue("name").let { if (it is JsonNull) null else it.jsonPrimitive.content }
            assertEquals("$name", case.text("initials"), initials(name))
        }
    }

    @Test
    fun aJoinedMonthFollowsEveryVector() {
        for (case in cases("month").map { it.jsonObject }) {
            assertEquals(case.text("month"), case.text("expected"), monthName(case.text("month")))
        }
    }

    @Test
    fun aRowStampFollowsEveryVector() {
        val zone = java.time.ZoneId.of(vectors.text("zone"))
        for (case in cases("stamp").map { it.jsonObject }) {
            assertEquals(
                "${case.text("at")} from ${case.text("now")}",
                case.text("expected"),
                Dates.stamp(case.millis("at"), case.millis("now"), "Í gær", zone),
            )
        }
    }

    @Test
    fun theListStampTakesItsNowFromTheCaller() {
        // The composable's body: the same call with the brand's word for yesterday.
        for (case in cases("listStamp").map { it.jsonObject }) {
            assertEquals(
                "${case.text("at")} from ${case.text("now")}",
                case.text("expected"),
                Dates.stamp(case.millis("at"), case.millis("now"), "Í gær"),
            )
        }
    }

    @Test
    fun aProblemIsWordedAsEveryVector() {
        for (case in cases("problem").map { it.jsonObject }) {
            val code = case.getValue("code").let { if (it is JsonNull) null else it.jsonPrimitive.content }
            val error =
                if (case.text("outcome") == "unreachable") {
                    CoreException.Unreachable("no answer")
                } else {
                    // The core's refusal always has a code; a body without one reaches the apps as an empty one.
                    val status = case.getValue("status").jsonPrimitive.int
                    CoreException.Refused(status.toUShort(), code.orEmpty(), null)
                }
            val shown = error.problem().message()
            assertEquals("${case.text("outcome")} $code", stringId(case.text("key")), shown)
        }
    }

    private fun nullable(element: kotlinx.serialization.json.JsonElement) =
        if (element is JsonNull) null else element.jsonPrimitive.content

    @Test
    fun aNoticeReadsAsEveryVector() {
        for (case in cases("notice").map { it.jsonObject }) {
            val key = case.text("key")
            val names = case.getValue("actors").jsonArray.map { nullable(it) }
            val where = "${case.text("kind")} $names ${case["actorCount"]}"
            val kind = SocialNotificationKind.valueOf(case.text("kind").uppercase())
            val line =
                noticeLine(
                    kind,
                    names,
                    case
                        .getValue("actorCount")
                        .jsonPrimitive.int
                        .toLong(),
                    case["action"]?.jsonPrimitive?.content?.let { NotificationAction.valueOf(it.uppercase()) },
                )
            val id = if (key.endsWith("_many")) R.plurals::class.java.getField(key).getInt(null) else stringId(key)
            assertEquals(where, id, line.key)
            assertEquals(where, key.endsWith("_many"), line.plural)
            val args = case.getValue("args").jsonObject
            if (args.containsKey("name")) assertEquals(where, nullable(args.getValue("name")), line.name)
            if (args.containsKey("other")) assertEquals(where, nullable(args.getValue("other")), line.other)
            if (args.containsKey("count")) assertEquals(where, args.getValue("count").jsonPrimitive.int, line.count)
            assertEquals(where, NoticeBadge.valueOf(case.text("badge").uppercase()), line.badge)
        }
    }
}
