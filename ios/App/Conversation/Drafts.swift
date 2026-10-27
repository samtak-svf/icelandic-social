import Foundation

/// The unsent text of each conversation's composer, kept for as long as the app runs, so leaving a
/// conversation and coming back finds it where it was. One per signed-in home: a conversation's model
/// goes with its screen, this does not.
///
/// Memory only, on purpose: a draft is message text this app otherwise keeps only in the core's
/// encrypted store, so it is never written to disk beside it.
@MainActor
final class Drafts {
    private var texts: [String: String] = [:]

    init() {}

    /// The draft of `conversation`; a blank one is no draft.
    subscript(conversation: String) -> String {
        get { texts[conversation] ?? "" }
        set {
            if newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                texts[conversation] = nil
            } else {
                texts[conversation] = newValue
            }
        }
    }
}
