package samtak.spjall.me.link

/** What the two link screens can ask for. */
interface LinkActions {
    /** Leaves the screen; from typing the code it goes back to the camera instead. */
    fun back()

    fun paste()

    /** Text from the camera or the field. */
    fun submit(text: String)

    /** Back to looking for a code, after one was refused. */
    fun again()

    fun retry()

    fun choose(history: LinkViewModel.History)

    fun approve()
}
