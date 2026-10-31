package samtak.spjall.social

/** What a post form does about the images and the poll that can go with its text; a community's and a wall's. */
interface Attaching {
    /** Opens the picker for an image to go with the post, when another fits. */
    fun addImage()

    /** Takes a picked image out of the post. */
    fun removeImage(path: String)

    /** Turns the post being written into a poll (0090), or back. */
    fun togglePoll()

    fun pollOption(
        index: Int,
        text: String,
    )

    fun addPollOption()

    fun removePollOption(index: Int)
}
