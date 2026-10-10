package samtak.spjall.people

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.brand.R
import samtak.spjall.core.Person
import samtak.spjall.ui.SpjallTheme

@RunWith(AndroidJUnit4::class)
class PeopleScreenTest {
    @get:Rule val compose = createComposeRule()

    private val calls = mutableListOf<String>()
    private val actions =
        object : PeopleActions {
            override fun toggle(account: String) {
                calls += "toggle $account"
            }

            override fun start() {
                calls += "start"
            }

            override fun search(text: String) {
                calls += "search $text"
            }

            override fun more() {
                calls += "more"
            }

            override fun invite() {
                calls += "invite"
            }

            override fun retry() {
                calls += "retry"
            }
        }

    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    private val people = listOf(Person("a2", "Anna", true), Person("a3", null, false))

    private fun show(state: PeopleViewModel.State) = compose.setContent { SpjallTheme { PeopleScreen(state, actions) } }

    @Test
    fun aRowIsACheckboxAndNothingStartsUntilSomeoneIsPicked() {
        show(PeopleViewModel.State(people = people, loaded = true))
        compose.onNodeWithText(text(R.string.contact_action)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.person_unnamed)).assertIsDisplayed()
        compose.onNodeWithText("Anna").assertIsOff().performClick()
        assertEquals(listOf("toggle a2"), calls)
    }

    @Test
    fun onlyAVerifiedPersonCarriesTheMark() {
        show(PeopleViewModel.State(people = people, loaded = true))
        compose
            .onAllNodesWithContentDescription(text(R.string.verified_with_kennitala), useUnmergedTree = true)
            .assertCountEquals(1)
    }

    @Test
    fun twoPickedMakeAGroup() {
        show(PeopleViewModel.State(people = people, loaded = true, picked = listOf("a2", "a3")))
        compose.onNodeWithText(text(R.string.new_group)).assertIsDisplayed()
        compose.onNodeWithText("Anna").assertIsOn()
        compose.onNodeWithText(text(R.string.contact_action)).performClick()
        assertEquals(listOf("start"), calls)
    }

    @Test
    fun withNobodyMetItPointsAtTheInvite() {
        show(PeopleViewModel.State(loaded = true))
        compose.onNodeWithText(text(R.string.people_empty)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.invite)).performClick()
        assertEquals(listOf("invite"), calls)
    }

    @Test
    fun everyoneElseComesUnderTheirOwnHeadingAndTypingSearches() {
        val others = listOf(Person("a4", "Bára", true), Person("a2", "Anna", true))
        show(PeopleViewModel.State(people = people, directory = others, loaded = true))
        compose.onNodeWithText(text(R.string.people_met)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.people_everyone)).assertIsDisplayed()
        // Anna was met: she is not listed twice.
        compose.onAllNodesWithText("Anna").assertCountEquals(1)
        compose.onNodeWithText("Bára").performClick()
        compose.onNodeWithText(text(R.string.people_search)).performTextInput("Bá")
        assertEquals(listOf("toggle a4", "search Bá"), calls)
    }

    @Test
    fun aSearchThatFindsNobodySaysSo() {
        show(PeopleViewModel.State(people = people, query = "zz", loaded = true))
        compose.onNodeWithText(text(R.string.people_none_found)).assertIsDisplayed()
        compose.onNodeWithText("Anna").assertDoesNotExist()
        compose.onNodeWithText(text(R.string.people_empty)).assertDoesNotExist()
    }

    @Test
    fun theLastRowAsksForTheNextPage() {
        show(PeopleViewModel.State(directory = listOf(Person("a4", "Bára", true)), next = "1", loaded = true))
        compose.waitForIdle()
        assertEquals(listOf("more"), calls)
    }
}
