import SpjallCore

/// Why an action failed, as far as the person can do something about it.
enum Problem: Equatable, Sendable {
    /// No answer from the server: trying again may work.
    case unreachable
    /// Kenni signed the person in, but there is no account and no live invite.
    case inviteRequired
    /// Anything else.
    case generic

    init(_ error: Error) {
        switch error {
        case CoreError.Unreachable: self = .unreachable
        case CoreError.Refused(_, "invite_required"): self = .inviteRequired
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
