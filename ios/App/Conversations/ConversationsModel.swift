import Foundation
import Observation
import SpjallCore

/// The conversation list (decision 0022): the core's summaries, read again
/// whenever an event may have changed one, and the socket's connection line.
/// An invite link opened while signed in opens its 1:1 from here.
@MainActor @Observable
final class ConversationsModel {
    private(set) var conversations: [Conversation] = []
    /// False until the first read, so the empty state does not flash.
    private(set) var loaded = false
    private(set) var problem: Problem?
    /// The invite link last opened is dead; shown until another is opened.
    private(set) var inviteExpired = false

    var connection: Connection { live.connection }

    private let account: Account
    private let live: Live
    private var reading = false
    private var readAgain = false

    init(account: Account, live: Live) {
        self.account = account
        self.live = live
    }

    /// Reads the list, then again after each event but typing, for as long as the screen shows.
    func follow() async {
        let events = live.events()
        await load()
        for await event in events {
            if case .typing = event { continue }
            await load()
        }
    }

    /// Reads the list. Asked for during a read, it reads once more after it.
    func load() async {
        guard !reading else {
            readAgain = true
            return
        }
        reading = true
        repeat {
            readAgain = false
            await read()
        } while readAgain
        reading = false
    }

    /// An invite link, opened while signed in: the 1:1 with whoever made it, to go into.
    func openInvite(token: String) async -> String? {
        inviteExpired = false
        let account = account
        do {
            let id = try await offMain { try account.openInvite(token: token) }
            live.sync()
            await load()
            return id
        } catch {
            if error.isNotFound {
                inviteExpired = true
            } else if case CoreError.Invalid = error {
                // The operator's link, or this account's own: no 1:1 to open.
            } else {
                problem = Problem(error)
            }
            return nil
        }
    }

    private func read() async {
        let account = account
        do {
            conversations = try await offMain { try account.conversations() }
            problem = nil
        } catch {
            problem = Problem(error)
        }
        loaded = true
    }
}
