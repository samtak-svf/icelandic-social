import SpjallCore

@testable import Spjall

/// What the fake server holds of friendships: the friends, the requests both ways and the snoozes, by account.
struct FriendServer {
    var friends: [Friend] = []
    var incoming: [FriendRequest] = []
    var sent: [FriendRequest] = []
    var snoozed: [Snooze] = []
    /// Everyone the server knows, so a person can be asked for whatever the lists say of them.
    var known: [String: Author] = [:]
}

/// The friend calls of `FakeSocial` (decision 0114).
extension FakeSocial {
    var server: FriendServer {
        get { lock.withLock { _server.friends } }
        set { lock.withLock { _server.friends = newValue } }
    }

    /// Adds an account the server knows, with how it stands to the reader.
    func know(_ author: Author, as relation: Relation) {
        var state = server
        state.known[author.accountId] = author
        switch relation {
        case .friends: state.friends.append(Friend(person: author, since: 5))
        case .sent: state.sent.append(FriendRequest(person: author, sentAt: 4))
        case .incoming: state.incoming.append(FriendRequest(person: author, sentAt: 3))
        case .none, .oneself, .unknown: break
        }
        server = state
    }

    func person(_ account: String) throws -> PersonProfile {
        try call("person \(account)")
        let state = server
        guard let author = state.known[account] else { throw unreachable }
        var relation = Relation.none
        if state.friends.contains(where: { $0.person.accountId == account }) { relation = .friends }
        if state.sent.contains(where: { $0.person.accountId == account }) { relation = .sent }
        if state.incoming.contains(where: { $0.person.accountId == account }) { relation = .incoming }
        return PersonProfile(
            accountId: account, name: author.name, verified: author.verified, photo: nil, photoFrames: nil,
            relation: relation, friendsSince: state.friends.first { $0.person.accountId == account }?.since,
            friendCount: UInt64(state.friends.count), mutualCount: 0, mutualFriends: [], sharedCommunities: [],
            snoozedUntil: state.snoozed.first { $0.person.accountId == account }?.until)
    }

    func friends(sort: FriendSort, query: String?) throws -> FriendPage {
        try call("friends \(sort) \(query ?? "-")")
        let all = server.friends
        var found = all.filter { query == nil || ($0.person.name ?? "").localizedCaseInsensitiveContains(query!) }
        switch sort {
        case .newest: found.sort { $0.since > $1.since }
        case .name: found.sort { ($0.person.name ?? "") < ($1.person.name ?? "") }
        }
        return FriendPage(count: UInt64(all.count), friends: found)
    }

    func friendRequests() throws -> FriendRequests {
        try call("friendRequests")
        return FriendRequests(incoming: server.incoming, sent: server.sent)
    }

    func sendFriendRequest(_ account: String) throws -> Relation {
        try call("sendFriendRequest \(account)")
        var state = server
        guard let author = state.known[account] else { throw unreachable }
        if state.incoming.contains(where: { $0.person.accountId == account }) {
            state.incoming.removeAll { $0.person.accountId == account }
            state.friends.append(Friend(person: author, since: 6))
            server = state
            return .friends
        }
        state.sent.append(FriendRequest(person: author, sentAt: 6))
        server = state
        return .sent
    }

    func cancelFriendRequest(_ account: String) throws {
        try call("cancelFriendRequest \(account)")
        server.sent.removeAll { $0.person.accountId == account }
    }

    func acceptFriendRequest(_ account: String) throws {
        try call("acceptFriendRequest \(account)")
        var state = server
        if let request = state.incoming.first(where: { $0.person.accountId == account }) {
            state.incoming.removeAll { $0.person.accountId == account }
            state.friends.append(Friend(person: request.person, since: 6))
        }
        server = state
    }

    func declineFriendRequest(_ account: String) throws {
        try call("declineFriendRequest \(account)")
        server.incoming.removeAll { $0.person.accountId == account }
    }

    func endFriendship(_ account: String) throws {
        try call("endFriendship \(account)")
        server.friends.removeAll { $0.person.accountId == account }
    }

    func snoozes() throws -> [Snooze] {
        try call("snoozes")
        return server.snoozed
    }

    func snoozePerson(_ account: String) throws -> UInt64 {
        try call("snoozePerson \(account)")
        var state = server
        guard let author = state.known[account] else { throw unreachable }
        state.snoozed.append(Snooze(person: author, until: 99))
        server = state
        return 99
    }

    func unsnoozePerson(_ account: String) throws {
        try call("unsnoozePerson \(account)")
        server.snoozed.removeAll { $0.person.accountId == account }
    }
}
