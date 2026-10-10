import SpjallCore

/// Why an action failed, as far as the person can do something about it. A refusal keeps the
/// server's request id (decision 0037), so a tester can quote it.
enum Problem: Equatable, Sendable {
    /// No answer from the server: trying again may work.
    case unreachable
    /// The kennitala is already linked to another account (decision 0033).
    case identityTaken(requestId: String? = nil)
    /// A photo or file over the 25 MB limit (decision 0023): trying again cannot help.
    case tooLarge
    /// Anything else.
    case generic(requestId: String? = nil)

    init(_ error: Error) {
        switch error {
        case CoreError.Unreachable: self = .unreachable
        case CoreError.Refused(_, "identity_taken", let requestId): self = .identityTaken(requestId: requestId)
        case CoreError.Refused(_, _, let requestId): self = .generic(requestId: requestId)
        default: self = .generic()
        }
    }

    /// The server's id for the refused request; nil when no server refused it.
    var requestId: String? {
        switch self {
        case let .identityTaken(requestId), let .generic(requestId): requestId
        case .unreachable, .tooLarge: nil
        }
    }

    /// Trying again cannot free a kennitala another account holds, nor shrink a file.
    var canRetry: Bool {
        switch self {
        case .identityTaken, .tooLarge: false
        case .unreachable, .generic: true
        }
    }
}

extension Error {
    /// The server answered 404: the thing asked for does not exist, or no longer does.
    var isNotFound: Bool {
        if case CoreError.Refused(404, _, _) = self as Error { return true }
        return false
    }
}
