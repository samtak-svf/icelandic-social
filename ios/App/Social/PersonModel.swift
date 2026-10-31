import Foundation
import Observation
import SpjallCore

/// A person's screen (decision 0114): the account as this one sees it, and what can be done about the request or the
/// friendship between them. Every action asks the server and then reads the person again, so what shows is what
/// the server holds (the relation after "add" can be `friends` when they had already asked).
@MainActor @Observable
final class PersonModel {
    let accountId: String
    private(set) var person: PersonProfile?
    private(set) var loaded = false
    private(set) var busy = false
    private(set) var problem: Problem?
    /// The reader blocked this account from here: the screen has nothing left to show and goes back (decision 0114).
    private(set) var blocked = false

    private let social: Social
    private var failed: (() async -> Void)?

    init(social: Social, accountId: String) {
        self.social = social
        self.accountId = accountId
    }

    func load() async {
        await run(again: { await self.load() }) {}
    }

    func retry() async { await failed?() }

    func perform(_ action: RelationAction) async {
        let social = social
        let id = accountId
        switch action {
        case .add: await run(again: { await self.perform(action) }) { _ = try social.sendFriendRequest(id) }
        case .cancel: await run(again: { await self.perform(action) }) { try social.cancelFriendRequest(id) }
        case .accept: await run(again: { await self.perform(action) }) { try social.acceptFriendRequest(id) }
        case .decline: await run(again: { await self.perform(action) }) { try social.declineFriendRequest(id) }
        }
    }

    func end() async {
        let social = social
        let id = accountId
        await run(again: { await self.end() }) { try social.endFriendship(id) }
    }

    func snooze() async {
        let social = social
        let id = accountId
        await run(again: { await self.snooze() }) { _ = try social.snoozePerson(id) }
    }

    func unsnooze() async {
        let social = social
        let id = accountId
        await run(again: { await self.unsnooze() }) { try social.unsnoozePerson(id) }
    }

    /// Blocks the account (decision 0024). There is no person to read afterwards, since the route answers 404 after a
    /// block, so the model says it is done instead of reading again.
    func block() async {
        guard !busy else { return }
        let social = social
        let id = accountId
        busy = true
        problem = nil
        do {
            try await offMain { try social.blockPerson(id) }
            blocked = true
            person = nil
            failed = nil
        } catch {
            failed = { await self.block() }
            problem = Problem(error)
        }
        busy = false
    }

    /// Makes the change, then reads the person again. A person who is not there, or is behind a block, is a
    /// `notFound` problem with no person.
    private func run(again: @escaping () async -> Void, _ change: @escaping @Sendable () throws -> Void) async {
        guard !busy else { return }
        let social = social
        let id = accountId
        busy = true
        problem = nil
        do {
            person = try await offMain {
                try change()
                return try social.person(id)
            }
            failed = nil
        } catch {
            failed = again
            problem = Problem(error)
        }
        loaded = true
        busy = false
    }
}
