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
    fun anOlderServerNamesNoRequestId() {
        assertEquals(Problem.Generic(), CoreException.Refused(500u, "internal", null).problem())
    }

    @Test
    fun anUnreachableServerOrALocalFailureHasNone() {
        assertNull(CoreException.Unreachable("timeout").problem().requestId)
        assertNull(IllegalStateException().problem().requestId)
    }
}
