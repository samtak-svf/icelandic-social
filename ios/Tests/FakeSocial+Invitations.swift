import SpjallCore

@testable import Spjall

extension Community {
    /// What a join does to an invitation: the account is in, and nothing waits any more.
    mutating func admit() {
        role = .member
        invited = false
        invitedBy = nil
    }

    /// What taking back a join request does to an invitation too: the server ends both.
    mutating func endRequests() {
        joinRequested = false
        invited = false
        invitedBy = nil
    }
}

/// The invitation calls of `FakeSocial` (decision 0130).
extension FakeSocial {
    /// The invitations that wait in each community, newest first.
    var invitations: [String: [CommunityInvitation]] {
        get { lock.withLock { _server.invitations } }
        set { lock.withLock { _server.invitations = newValue } }
    }

    func communityInvitations(_ community: String) throws -> [CommunityInvitation] {
        try call("communityInvitations \(community)")
        return invitations[community] ?? []
    }

    func withdrawInvitation(_ community: String, account: String) throws {
        try call("withdrawInvitation \(community) \(account)")
        invitations[community]?.removeAll { $0.accountId == account }
    }
}
