package samtak.spjall.conversation

import samtak.spjall.core.Item
import samtak.spjall.core.MuteFor

/** A conversation's actions that do nothing, for a screenshot or a test that only looks. */
internal val IdleActions =
    object : ConversationActions {
        override fun back() = Unit

        override fun draft(text: String) = Unit

        override fun send() = Unit

        override fun reply(item: Item) = Unit

        override fun forward(item: Item) = Unit

        override fun edit(item: Item) = Unit

        override fun cancelMode() = Unit

        override fun delete(item: Item) = Unit

        override fun react(
            item: Item,
            emoji: String,
        ) = Unit

        override fun resend() = Unit

        override fun loadOlder() = Unit

        override fun attachPhoto() = Unit

        override fun takePhoto() = Unit

        override fun attachFile() = Unit

        override fun removeAttachment() = Unit

        override fun attachLocation() = Unit

        override fun sendLocation() = Unit

        override fun cancelLocation() = Unit

        override fun openPlace(uri: String) = Unit

        override fun fetch(item: Item) = Unit

        override fun open(item: Item) = Unit

        override fun timer(seconds: UInt?) = Unit

        override fun mute(duration: MuteFor) = Unit

        override fun unmute() = Unit

        override fun block() = Unit

        override fun info() = Unit

        override fun retry() = Unit

        override fun paused() = Unit
    }
