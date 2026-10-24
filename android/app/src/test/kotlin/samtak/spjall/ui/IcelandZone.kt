package samtak.spjall.ui

import org.junit.rules.ExternalResource
import java.util.TimeZone

/**
 * Runs each test in Iceland's time zone and gives the host's back afterwards, so a
 * golden that shows a date or a time renders the same on every machine.
 */
class IcelandZone : ExternalResource() {
    private var saved: TimeZone? = null

    override fun before() {
        saved = TimeZone.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone("Atlantic/Reykjavik"))
    }

    override fun after() = TimeZone.setDefault(saved)
}
