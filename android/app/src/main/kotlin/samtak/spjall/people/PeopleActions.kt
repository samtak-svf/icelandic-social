package samtak.spjall.people

/** What [PeopleScreen] can ask for. */
interface PeopleActions {
    fun toggle(account: String)

    fun start()

    /** To the invite link and QR code in "Ég". */
    fun invite()

    fun retry()
}
