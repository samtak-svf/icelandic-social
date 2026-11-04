import Foundation
import SpjallCore

@testable import Spjall

/// Answering an invitation, as the fake has it: the calls that end a notice of the caller's announce it, as
/// `CoreAccount` does (#570). Apart from `FakeSocial.swift` so that file stays under its cap.
extension FakeSocial {
    func joinCommunity(_ id: String) throws -> JoinState {
        try call("joinCommunity \(id)")
        defer { noticeChanges.announce() }
        guard var found = communities[id] else { throw notFound }
        let state = joins[id] ?? (found.audience == .open || found.invited ? .member : .requested)
        switch state {
        case .member:
            found.admit()
            mine.append(id)
        case .requested:
            found.joinRequested = true
        }
        communities[id] = found
        return state
    }

    func withdrawJoinRequest(_ id: String) throws {
        try call("withdrawJoinRequest \(id)")
        defer { noticeChanges.announce() }
        guard var found = communities[id] else { throw notFound }
        found.endRequests()
        communities[id] = found
    }
}
