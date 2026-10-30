package samtak.spjall.social

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import samtak.spjall.ui.Suspension

@OptIn(ExperimentalCoroutinesApi::class)
class SuspensionViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val social = FakeSocial()
    private var now = NOW

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun model() = SuspensionViewModel(social, dispatcher) { now }

    @Test
    fun anAccountNobodyHoldsHasNoSuspension() =
        runTest(dispatcher) {
            val model = model()
            model.load()
            advanceUntilIdle()
            assertNull(model.state.value)
        }

    @Test
    fun aSuspensionWithAnEndInTheFutureStands() =
        runTest(dispatcher) {
            social.mySuspension = Suspension(NOW.toULong() + 1_000uL)
            val model = model()
            model.load()
            advanceUntilIdle()
            assertEquals(Suspension(NOW.toULong() + 1_000uL), model.state.value)
        }

    @Test
    fun aSuspensionWithNoEndStandsUntilItIsLifted() =
        runTest(dispatcher) {
            social.mySuspension = Suspension(null)
            val model = model()
            model.load()
            advanceUntilIdle()
            assertEquals(Suspension(null), model.state.value)
            social.mySuspension = null
            model.load()
            advanceUntilIdle()
            assertNull(model.state.value)
        }

    @Test
    fun aSuspensionWhoseEndHasPassedIsOver() =
        runTest(dispatcher) {
            social.mySuspension = Suspension(NOW.toULong() - 1uL)
            val model = model()
            model.load()
            advanceUntilIdle()
            assertNull(model.state.value)
        }

    private companion object {
        const val NOW = 1_800_000_000_000L
    }
}
