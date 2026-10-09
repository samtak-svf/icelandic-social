import SpjallCore

/// Why an action failed, as far as the person can do something about it.
enum Problem: Equatable, Sendable {
    /// No answer from the server: trying again may work.
    case unreachable
    /// The kennitala is already linked to another account (decision 0033).
    case identityTaken
    /// A photo or file over the 25 MB limit (decision 0023): trying again cannot help.
    case tooLarge
    /// Anything else.
    case generic

    init(_ error: Error) {
        switch error {
        case CoreError.Unreachable: self = .unreachable
        case CoreError.Refused(_, "identity_taken"): self = .identityTaken
        default: self = .generic
        }
    }
}

extension Error {
    /// The server answered 404: the thing asked for does not exist, or no longer does.
    var isNotFound: Bool {
        if case CoreError.Refused(404, _) = self as Error { return true }
        return false
    }
}
