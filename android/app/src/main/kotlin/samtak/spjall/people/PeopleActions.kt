package samtak.spjall.people

/** What [PeopleScreen] can ask for. */
interface PeopleActions {
    fun toggle(account: String)

    fun start()

    /** The name search changed (decision 0036). */
    fun search(text: String)

    /** The end of the list came into view: the next page of the directory. */
    fun more()

    /** To the invite link and QR code in "Ég". */
    fun invite()

    fun retry()
}
