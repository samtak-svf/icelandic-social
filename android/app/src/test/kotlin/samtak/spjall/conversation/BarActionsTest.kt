package samtak.spjall.conversation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import samtak.spjall.brand.R
import samtak.spjall.ui.AppIcons

/** How the long-press bar fills its four slots (0072). */
class BarActionsTest {
    private fun actions(vararg kinds: MenuKind) =
        kinds.map { MenuAction(it, R.string.reply, AppIcons.Reply, danger = it == MenuKind.Delete) {} }

    private fun MenuBar.kinds() = slots.map { it.kind } to more.map { it.kind }

    @Test
    fun anOwnTextHasDeleteThirdAndTheRestBehindMore() {
        val bar = barActions(actions(MenuKind.Reply, MenuKind.Copy, MenuKind.Forward, MenuKind.Edit, MenuKind.Delete))
        assertEquals(
            listOf(MenuKind.Reply, MenuKind.Copy, MenuKind.Delete) to listOf(MenuKind.Forward, MenuKind.Edit),
            bar.kinds(),
        )
    }

    @Test
    fun someoneElsesTextFitsWithoutMore() {
        val bar = barActions(actions(MenuKind.Reply, MenuKind.Copy, MenuKind.Forward))
        assertEquals(listOf(MenuKind.Reply, MenuKind.Copy, MenuKind.Forward) to emptyList<MenuKind>(), bar.kinds())
    }

    @Test
    fun anOwnTextUnderATimerHasFourAndNoMore() {
        val bar = barActions(actions(MenuKind.Reply, MenuKind.Copy, MenuKind.Edit, MenuKind.Delete))
        assertEquals(
            listOf(MenuKind.Reply, MenuKind.Copy, MenuKind.Delete, MenuKind.Edit) to emptyList<MenuKind>(),
            bar.kinds(),
        )
    }

    @Test
    fun anOwnLocationKeepsForwardInTheBar() {
        val bar = barActions(actions(MenuKind.Reply, MenuKind.Copy, MenuKind.Forward, MenuKind.Delete))
        assertEquals(
            listOf(MenuKind.Reply, MenuKind.Copy, MenuKind.Delete, MenuKind.Forward) to emptyList<MenuKind>(),
            bar.kinds(),
        )
    }

    @Test
    fun deleteIsNeverBehindMore() {
        val all = MenuKind.entries.toTypedArray()
        listOf(all, all.reversedArray()).forEach { kinds ->
            val bar = barActions(actions(*kinds))
            assertFalse(bar.more.any { it.kind == MenuKind.Delete })
            assertEquals(4, bar.slots.size + 1)
        }
    }
}
