import Foundation
import SpjallCore

/// The invitation calls of the hosted social API (decision 0130), apart from `Social` so that file stays under its
/// cap. Both are for a community's moderators; answering an invitation is the join and withdraw-join-request calls.
protocol Inviting: Sendable {
    /// The invitations that wait in a community, newest first.
    func communityInvitations(_ community: String) throws -> [CommunityInvitation]
    /// Takes an invitation back, and its notice with it.
    func withdrawInvitation(_ community: String, account: String) throws
}

extension CoreAccount: Inviting {
    func communityInvitations(_ community: String) throws -> [CommunityInvitation] {
        try core().communityInvitations(communityId: community)
    }

    func withdrawInvitation(_ community: String, account: String) throws {
        try core().withdrawInvitation(communityId: community, accountId: account)
    }
}
