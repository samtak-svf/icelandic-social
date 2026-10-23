package samtak.spjall.me

import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.account.Account
import samtak.spjall.brand.R
import samtak.spjall.core.LinkRequest
import samtak.spjall.me.link.LinkActions
import samtak.spjall.me.link.LinkApproveScreen
import samtak.spjall.me.link.LinkScanScreen
import samtak.spjall.me.link.LinkViewModel
import samtak.spjall.ui.SpjallTheme
import java.lang.reflect.Proxy

/** Pasting a browser's link code, choosing no history and approving it (decisions 0064, 0077). */
@RunWith(AndroidJUnit4::class)
class LinkApproveScreenTest {
    @get:Rule val compose = createComposeRule()

    private val approvals = mutableListOf<Pair<ULong?, Boolean>>()

    /** An account that answers only the two link calls, as the view model asks nothing else of it. */
    private val account: Account =
        Proxy.newProxyInstance(Account::class.java.classLoader, arrayOf(Account::class.java)) { _, method, args ->
            // A function taking an unsigned number has its name mangled on the JVM, and returns it as a long.
            when {
                method.name == "inspectLink" -> LinkRequest("Firefox", "Linux", 1L, false)
                method.name.startsWith("approveLink") -> {
                    val since =
                        when (val value = args[1]) {
                            null -> null
                            is ULong -> value
                            is Long -> value.toULong()
                            else -> error("unexpected since $value")
                        }
                    approvals += since to (args[2] as Boolean)
                    0L
                }
                else -> error("unexpected ${method.name}")
            }
        } as Account

    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    @Test
    fun pasteAChooseNoHistoryAndApprove() {
        // The text check is the core's in the app; the test says what a code looks like.
        val model = LinkViewModel(account, isCode = { it == CODE }, io = Dispatchers.Main.immediate)
        compose.setContent {
            SpjallTheme {
                val state by model.state.collectAsStateWithLifecycle()
                val actions =
                    object : LinkActions {
                        override fun back() = model.scan()

                        override fun paste() = model.paste()

                        override fun submit(text: String) = model.submit(text)

                        override fun again() = model.again()

                        override fun retry() = model.retry()

                        override fun choose(history: LinkViewModel.History) = model.choose(history)

                        override fun approve() = model.approve()
                    }
                when (state) {
                    is LinkViewModel.State.Approve, is LinkViewModel.State.Sending, LinkViewModel.State.Done ->
                        LinkApproveScreen(state, actions)
                    else -> LinkScanScreen(state, actions, isCode = { it == CODE })
                }
            }
        }
        compose.onNodeWithText(text(R.string.device_link_paste)).performClick()
        compose.onNodeWithText(text(R.string.device_link_code_field)).performTextInput(CODE)
        compose.onNodeWithText(text(R.string.device_link_continue)).performClick()
        compose.waitUntil(TIMEOUT) { model.state.value is LinkViewModel.State.Approve }
        compose.onNodeWithText(text(R.string.device_link_history_none)).performClick()
        compose.onNodeWithText(text(R.string.device_link_approve)).performClick()
        compose.waitUntil(TIMEOUT) { model.state.value == LinkViewModel.State.Done }
        compose.onNodeWithText(text(R.string.device_link_done)).assertIsDisplayed()
        assertEquals(listOf<Pair<ULong?, Boolean>>(null to false), approvals)
    }

    private companion object {
        const val CODE = "link-test-code"
        const val TIMEOUT = 5_000L
    }
}
