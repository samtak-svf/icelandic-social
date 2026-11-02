package samtak.spjall.base

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import samtak.spjall.account.Problem
import samtak.spjall.core.CoreException
import samtak.spjall.core.InternalException

/** A screen's state, in the terms [BaseViewModel] writes: busy, a problem, and whether it has answered. */
private data class TestState(
    override val busy: Boolean = false,
    override val problem: Problem? = null,
    val loaded: Boolean = false,
) : ScreenState<TestState> {
    override fun busy(on: Boolean): TestState = copy(busy = on)

    override fun trouble(problem: Problem?): TestState = copy(problem = problem)

    override fun answered(): TestState = copy(loaded = true)
}

/** One action, counted, that may wait on [gate] and may fail with [failure]. */
private class TestModel(
    io: CoroutineDispatcher,
) : BaseViewModel<TestState>(TestState(), io) {
    var runs = 0
    var gate: CompletableDeferred<Unit>? = null
    var failure: Throwable? = null

    fun go() =
        perform(::go) {
            runs++
            gate?.await()
            failure?.let { throw it }
        }
}

@OptIn(ExperimentalCoroutinesApi::class)
class BaseViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun main() = Dispatchers.setMain(dispatcher)

    @After fun reset() = Dispatchers.resetMain()

    private fun model() = TestModel(dispatcher)

    @Test
    fun aSecondCallWhileOneRunsIsIgnored() =
        runTest(dispatcher) {
            val model = model()
            val gate = CompletableDeferred<Unit>()
            model.gate = gate
            model.go()
            advanceUntilIdle()
            assertTrue(model.state.value.busy)
            model.go()
            advanceUntilIdle()
            gate.complete(Unit)
            advanceUntilIdle()
            assertEquals(1, model.runs)
            assertFalse(model.state.value.busy)
        }

    @Test
    fun aFailureShowsItsProblemOnAnAnsweredScreen() =
        runTest(dispatcher) {
            val model = model()
            model.failure = CoreException.Unreachable("no answer")
            model.go()
            advanceUntilIdle()
            assertEquals(Problem.Unreachable, model.state.value.problem)
            assertTrue(model.state.value.loaded)
            assertFalse(model.state.value.busy)
        }

    @Test
    fun aRetryRunsTheActionThatFailedAgain() =
        runTest(dispatcher) {
            val model = model()
            model.failure = CoreException.Unreachable("no answer")
            model.go()
            advanceUntilIdle()
            model.failure = null
            model.retry()
            advanceUntilIdle()
            assertEquals(2, model.runs)
            assertNull(model.state.value.problem)
            assertFalse(model.state.value.busy)
        }

    @Test
    fun aFailureWithNoCoreAnswerIsANamelessProblem() =
        runTest(dispatcher) {
            val model = model()
            model.failure = InternalException("Rust panic")
            model.go()
            advanceUntilIdle()
            assertEquals(Problem.Generic(), model.state.value.problem)
            assertFalse(model.state.value.busy)
            assertTrue(model.state.value.loaded)
        }

    @Test
    fun aCancelledActionLeavesTheStateAsItWas() =
        runTest(dispatcher) {
            val model = model()
            model.failure = CancellationException("gone")
            model.go()
            advanceUntilIdle()
            assertEquals(1, model.runs)
            assertNull(model.state.value.problem)
            assertTrue(model.state.value.busy)
        }
}
