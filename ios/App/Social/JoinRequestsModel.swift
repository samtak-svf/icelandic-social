import Foundation
import Observation
import SpjallCore

/// The join requests that wait in a private community (#354, decision 0070), oldest first. A moderator takes
/// an account in, or declines it, and the account may ask again after 30 days. An answered request leaves the
/// list; the list is then asked for again.
@MainActor @Observable
final class JoinRequestsModel {
    let communityId: String
    private(set) var requests: [JoinRequest] = []
    private(set) var loaded = false
    /// The account whose answer is on its way, so a second tap waits for the first.
    private(set) var answering: String?
    private(set) var problem: Problem?

    private let social: Social
    private var failed: (() async -> Void)?

    init(social: Social, communityId: String) {
        self.social = social
        self.communityId = communityId
    }

    func load() async {
        guard answering == nil else { return }
        let social = social
        let id = communityId
        problem = nil
        do {
            requests = try await offMain { try social.joinRequests(id) }
            failed = nil
        } catch {
            failed = { await self.load() }
            problem = Problem(error)
        }
        loaded = true
    }

    /// Takes the requesting account in as a member.
    func approve(_ request: JoinRequest) async {
        let social = social
        let id = communityId
        await answer(request, again: { await self.approve(request) }) {
            try social.approveJoinRequest(id, account: request.accountId)
        }
    }

    /// Declines the request.
    func decline(_ request: JoinRequest) async {
        let social = social
        let id = communityId
        await answer(request, again: { await self.decline(request) }) {
            try social.declineJoinRequest(id, account: request.accountId)
        }
    }

    /// Tries the action that failed again.
    func retry() async {
        await failed?()
    }

    private func answer(
        _ request: JoinRequest, again: @escaping () async -> Void, _ call: @escaping @Sendable () throws -> Void
    ) async {
        guard answering == nil else { return }
        answering = request.accountId
        problem = nil
        do {
            try await offMain(call)
            requests.removeAll { $0.accountId == request.accountId }
            failed = nil
        } catch {
            failed = again
            problem = Problem(error)
        }
        answering = nil
    }
}
