package samtak.spjall.me

import org.junit.Assert.assertSame
import org.junit.Test
import samtak.spjall.core.DeviceKind
import samtak.spjall.ui.AppIcons

class DeviceIconTest {
    @Test
    fun aBrowserIsAGlobe() {
        assertSame(AppIcons.Globe, deviceIcon(DeviceKind.WEB))
    }

    @Test
    fun aPhoneIsAPhone() {
        assertSame(AppIcons.Phone, deviceIcon(DeviceKind.PHONE))
    }
}
