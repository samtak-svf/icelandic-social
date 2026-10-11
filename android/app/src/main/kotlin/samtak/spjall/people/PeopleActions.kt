package samtak.spjall.people

/** What [PeopleScreen] can ask for. */
interface PeopleActions {
    /** A tap on a person outside group mode: into the 1:1 with them (decision 0043). */
    fun open(account: String)

    /** "Nýr hópur": pick several. */
    fun group()

    /** Back out of picking several. */
    fun single()

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
