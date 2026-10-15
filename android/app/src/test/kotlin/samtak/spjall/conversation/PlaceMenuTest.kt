package samtak.spjall.conversation

import org.junit.Assert.assertEquals
import org.junit.Test

/** Where the lifted message and its two cards go (0054): in place when they fit, else moved the least. */
class PlaceMenuTest {
    private fun place(
        bubbleTop: Int,
        bubbleHeight: Int,
        reactions: Int = 50,
        actions: Int = 200,
    ) = placeMenu(
        bubbleTop = bubbleTop,
        bubbleHeight = bubbleHeight,
        reactions = reactions,
        actions = actions,
        gap = 10,
        windowTop = 100,
        windowBottom = 1000,
    )

    @Test
    fun aMessageWithRoomAboveAndBelowStaysWhereItIs() {
        assertEquals(
            MenuPlace(reactionsTop = 340, bubbleTop = 400, bubbleHeight = 80, actionsTop = 490),
            place(400, 80),
        )
    }

    @Test
    fun nearTheTopTheGroupMovesDownJustEnoughForTheReactions() {
        assertEquals(
            MenuPlace(reactionsTop = 100, bubbleTop = 160, bubbleHeight = 80, actionsTop = 250),
            place(120, 80),
        )
    }

    @Test
    fun nearTheBottomTheGroupMovesUpJustEnoughForTheActions() {
        // 80 + 10 + 200 below the bubble's top must end by 1000.
        assertEquals(
            MenuPlace(reactionsTop = 650, bubbleTop = 710, bubbleHeight = 80, actionsTop = 800),
            place(900, 80),
        )
    }

    @Test
    fun aMessageTallerThanTheRoomIsCutSoBothCardsShow() {
        // 900 of room, less 50 + 10 above and 10 + 200 below, leaves 630 of the message.
        assertEquals(
            MenuPlace(reactionsTop = 100, bubbleTop = 160, bubbleHeight = 630, actionsTop = 800),
            place(0, 2000),
        )
    }

    @Test
    fun withoutReactionsNoGapIsKeptForThem() {
        assertEquals(
            MenuPlace(reactionsTop = 100, bubbleTop = 100, bubbleHeight = 80, actionsTop = 190),
            place(50, 80, reactions = 0),
        )
    }
}
