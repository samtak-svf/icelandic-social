import Foundation
import Observation
import SpjallCore

/// The people the friends screen suggests (decision 0114), read on their own: a read that fails, or an account that
/// is out of suggestions, leaves the section empty and says nothing, so the lists above it stay as they are.
@MainActor @Observable
final class SuggestionsModel {
    private(set) var people: [Author] = []
    private(set) var next: String?
    private(set) var loaded = false
    private(set) var paging = false
    /// The last page read failed: the sentinel stops asking until `load` starts over.
    private(set) var failed = false

    /// The sentinel at the foot of the section should ask for the next page now: there is one, none is on its way
    /// and the last try did not fail. It is the sentinel's task id, so it asks again once a busy call is over.
    var wantsMore: Bool { next != nil && !paging && !failed }

    private let social: Social
    /// The newest first-page read; an older answer that arrives later is dropped.
    private var ticket = 0

    init(social: Social) {
        self.social = social
    }

    func load() async {
        let social = social
        ticket += 1
        let mine = ticket
        failed = false
        do {
            let first = try await offMain { () -> FriendSuggestions? in
                try social.friendSuggestionsIncluded() ? try social.friendSuggestions(after: nil) : nil
            }
            guard mine == ticket else { return }
            people = first?.people ?? []
            next = first?.next
        } catch {
            guard mine == ticket else { return }
            people = []
            next = nil
        }
        loaded = true
    }

    /// The page after the last one, if there is one; the end is a nil `next`, never an empty page.
    func more() async {
        guard let after = next, !paging else { return }
        let social = social
        let mine = ticket
        paging = true
        defer { paging = false }
        let read = try? await offMain { try social.friendSuggestions(after: after) }
        guard mine == ticket else { return }
        guard let page = read else {
            failed = true
            return
        }
        let seen = Set(people.map(\.accountId))
        people += page.people.filter { !seen.contains($0.accountId) }
        next = page.next
    }

    /// Someone asked leaves the section at once.
    func drop(_ account: String) {
        people.removeAll { $0.accountId == account }
    }
}

/// The switch in settings (decision 0114): in or out of suggestions, both ways at once. A write that fails leaves the
/// switch as the server has it.
@MainActor @Observable
final class SuggestionSettingsModel {
    private(set) var included: Bool?
    private(set) var busy = false
    private(set) var problem: Problem?

    private let social: Social

    init(social: Social) {
        self.social = social
    }

    func load() async {
        let social = social
        do {
            included = try await offMain { try social.friendSuggestionsIncluded() }
            problem = nil
        } catch {
            problem = Problem(error)
        }
    }

    func set(_ value: Bool) async {
        guard included != nil, !busy else { return }
        let social = social
        busy = true
        problem = nil
        do {
            included = try await offMain {
                try social.setFriendSuggestionsIncluded(value)
                return try social.friendSuggestionsIncluded()
            }
        } catch {
            problem = Problem(error)
        }
        busy = false
    }
}
