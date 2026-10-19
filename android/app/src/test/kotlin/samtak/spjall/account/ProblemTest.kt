package samtak.spjall.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import samtak.spjall.core.CoreException

/** A refusal keeps the server's request id (decision 0037); nothing else invents one. */
class ProblemTest {
    @Test
    fun aRefusalKeepsTheRequestId() {
        assertEquals(Problem.Generic("req-1"), CoreException.Refused(403u, "blocked", "req-1").problem())
        assertEquals(Problem.IdentityTaken("req-2"), CoreException.Refused(409u, "identity_taken", "req-2").problem())
    }

    @Test
    fun aRefusalThePersonCanReadIsNamedWithoutAnId() {
        assertEquals(Problem.NotPermitted, CoreException.Refused(403u, "not_permitted", "req-3").problem())
        assertEquals(Problem.NotFound, CoreException.Refused(404u, "not_found", "req-4").problem())
        assertEquals(Problem.JoinDeclined, CoreException.Refused(403u, "join_declined", "req-5").problem())
        assertNull(Problem.NotPermitted.requestId)
    }

    @Test
    fun anOlderServerNamesNoRequestId() {
        assertEquals(Problem.Generic(), CoreException.Refused(500u, "internal", null).problem())
    }

    @Test
    fun anUnreachableServerOrALocalFailureHasNone() {
        assertNull(CoreException.Unreachable("timeout").problem().requestId)
        assertNull(IllegalStateException().problem().requestId)
    }

    @Test
    fun aLocalFailureWithoutTheNativeCoreIsGenericWithNoCode() {
        // The JVM has no native core; on a device the code comes from it (ProblemCardTest).
        assertEquals(Problem.Generic(), CoreException.Store("busy").problem())
        assertNull(CoreException.Refused(403u, "blocked", "req-1").problem().code)
    }
}
