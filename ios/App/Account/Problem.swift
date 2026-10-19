import SpjallCore

/// Why an action failed, as far as the person can do something about it. A refusal keeps the
/// server's request id (decision 0037), and a failure no server answered the core's code for it
/// (decision 0049), so a tester can quote either.
enum Problem: Equatable, Sendable {
    /// No answer from the server: trying again may work.
    case unreachable
    /// The kennitala is already linked to another account (decision 0033).
    case identityTaken(requestId: String? = nil)
    /// A photo or file over the 25 MB limit (decision 0023): trying again cannot help.
    case tooLarge
    /// The server refused it with `not_permitted` (#362): this account may not do that; trying again cannot help.
    case notPermitted
    /// The server refused it with `not_found`: what was asked for is gone.
    case notFound
    /// The server refused a join request because a moderator declined it (decision 0070).
    case joinDeclined
    /// Anything else.
    case generic(requestId: String? = nil, code: String? = nil)

    init(_ error: Error) {
        switch error {
        case CoreError.Unreachable: self = .unreachable
        case CoreError.Refused(_, "identity_taken", let requestId): self = .identityTaken(requestId: requestId)
        case CoreError.Refused(_, "not_permitted", _): self = .notPermitted
        case CoreError.Refused(_, "not_found", _): self = .notFound
        case CoreError.Refused(_, "join_declined", _): self = .joinDeclined
        case CoreError.Refused(_, _, let requestId): self = .generic(requestId: requestId)
        case let error as CoreError: self = .generic(code: error.code())
        default: self = .generic()
        }
    }

    /// The server's id for the refused request; nil when no server refused it.
    var requestId: String? {
        switch self {
        case let .identityTaken(requestId), let .generic(requestId, _): requestId
        case .unreachable, .tooLarge, .notPermitted, .notFound, .joinDeclined: nil
        }
    }

    /// The core's code for a failure no server answered (0049); nil for a refusal or no code.
    var code: String? {
        if case let .generic(_, code) = self { return code }
        return nil
    }

    /// Trying again cannot free a kennitala another account holds, nor shrink a file.
    var canRetry: Bool {
        switch self {
        case .identityTaken, .tooLarge, .notPermitted, .notFound, .joinDeclined: false
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
