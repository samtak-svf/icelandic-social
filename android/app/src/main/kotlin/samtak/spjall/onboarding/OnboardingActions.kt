package samtak.spjall.onboarding

/** What [OnboardingScreen] can ask for. */
interface OnboardingActions {
    /** Opens the photo picker of decision 0039. */
    fun choosePhoto()

    /** "Áfram" or "Sleppa": on from the photo. */
    fun photoDone()

    /** "Kveikja á tilkynningum": the system's prompt follows. */
    fun enable()

    fun notNow()

    /** Repeats what failed on the photo step. */
    fun retry()
}
