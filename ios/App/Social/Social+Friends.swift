import Foundation
import SpjallCore

/// The friend calls of the hosted social API (decision 0114), apart from `Social` so that file stays under its cap.
/// A person is any account; the lists are this account's own, and nobody else's exists.
protocol Friending: Sendable {
    /// An account as this one sees it, with what is between them. Refused with 404 when there is none, or a block
    /// stands between them.
    func person(_ account: String) throws -> PersonProfile
    /// This account's friends, those whose name matches `query` when there is one, and how many it has.
    func friends(sort: FriendSort, query: String?) throws -> FriendPage
    func friendRequests() throws -> FriendRequests
    /// `sent`, or `friends` when the other had already asked.
    func sendFriendRequest(_ account: String) throws -> Relation
    func cancelFriendRequest(_ account: String) throws
    func acceptFriendRequest(_ account: String) throws
    /// The one who asked is not told.
    func declineFriendRequest(_ account: String) throws
    /// The other account is not told.
    func endFriendship(_ account: String) throws
    func snoozes() throws -> [Snooze]
    /// Hides the account's posts from the home feed for 30 days; until when, in Unix milliseconds.
    func snoozePerson(_ account: String) throws -> UInt64
    func unsnoozePerson(_ account: String) throws
}

extension CoreAccount {
    func person(_ account: String) throws -> PersonProfile { try core().person(accountId: account) }

    func friends(sort: FriendSort, query: String?) throws -> FriendPage {
        try core().friends(sort: sort, query: query)
    }

    func friendRequests() throws -> FriendRequests { try core().friendRequests() }

    func sendFriendRequest(_ account: String) throws -> Relation {
        try core().sendFriendRequest(accountId: account)
    }

    func cancelFriendRequest(_ account: String) throws { try core().cancelFriendRequest(accountId: account) }

    func acceptFriendRequest(_ account: String) throws { try core().acceptFriendRequest(accountId: account) }

    func declineFriendRequest(_ account: String) throws { try core().declineFriendRequest(accountId: account) }

    func endFriendship(_ account: String) throws { try core().endFriendship(accountId: account) }

    func snoozes() throws -> [Snooze] { try core().snoozes() }

    func snoozePerson(_ account: String) throws -> UInt64 { try core().snoozePerson(accountId: account) }

    func unsnoozePerson(_ account: String) throws { try core().unsnoozePerson(accountId: account) }
}

extension PersonProfile {
    /// The photo to draw for this account, or nil when it has none (decision 0080).
    var photoOf: PhotoOf? { photo.map { PhotoOf(owner: accountId, version: $0) } }

    /// Their name as a screen says it, the word for an account with none when it has none.
    var shownName: String { name ?? localized("person_unnamed") }
}

/// What can be done about a request or a friendship, by where the two stand (decision 0114). `Oneself` and `Unknown`
/// (a relation a later server adds) offer nothing.
enum RelationAction: Equatable {
    case add, cancel, accept, decline

    /// Whether the action is the one the screen wants taken.
    var primary: Bool { self == .add || self == .accept }

    var label: String {
        switch self {
        case .add: "person_add_friend"
        case .cancel: "person_cancel_request"
        case .accept: "person_accept"
        case .decline: "person_decline"
        }
    }
}

/// The sentence over the actions, if the relation has one: the request sent, or the one to answer.
struct RelationOffer: Equatable {
    let sentence: String?
    let actions: [RelationAction]
}

func relationOffer(_ relation: Relation) -> RelationOffer {
    switch relation {
    case .none: RelationOffer(sentence: nil, actions: [.add])
    case .sent: RelationOffer(sentence: "person_request_sent", actions: [.cancel])
    case .incoming: RelationOffer(sentence: "person_answer_request", actions: [.accept, .decline])
    case .friends: RelationOffer(sentence: "person_friends", actions: [])
    case .oneself, .unknown: RelationOffer(sentence: nil, actions: [])
    }
}
