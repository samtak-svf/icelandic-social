import Foundation
import Observation
import SpjallCore

/// How loud each kind of notification is and each community (decision 0106): pushed to the phone, shown only in
/// the app, or off. A level the account never set is `push`. Moderators' actions have a floor: they are always
/// shown in the app, so that kind offers only push and in-app.
@MainActor @Observable
final class NotificationLevelsModel {
    /// The kinds a person can set, in the order the settings list them.
    static let kinds: [SocialNotificationKind] = [
        .comment, .reply, .reaction, .joinApproved, .moderated, .friendRequest, .friendAccepted,
    ]

    private(set) var settings: NotificationSettings?
    private(set) var problem: Problem?

    private let social: Social

    init(social: Social) {
        self.social = social
    }

    func load() async {
        let social = social
        do {
            settings = try await offMain { try social.notificationSettings() }
            problem = nil
        } catch {
            problem = Problem(error)
        }
    }

    /// The levels a kind offers: all three, but for the moderators' actions, which are never off.
    static func choices(for kind: SocialNotificationKind) -> [NotificationLevel] {
        kind == .moderated ? [.push, .inApp] : [.push, .inApp, .off]
    }

    func level(of kind: SocialNotificationKind) -> NotificationLevel {
        settings?.kinds.first { $0.kind == kind }?.level ?? .push
    }

    func level(ofCommunity id: String) -> NotificationLevel {
        settings?.communities.first { $0.communityId == id }?.level ?? .push
    }

    /// The communities with a level of their own set, for the settings list.
    var communityLevels: [CommunityNotificationLevel] { settings?.communities ?? [] }

    func set(_ kind: SocialNotificationKind, to level: NotificationLevel) async {
        guard Self.choices(for: kind).contains(level) else { return }
        let social = social
        let change = NotificationKindLevel(kind: kind, level: level)
        await save { try social.setNotificationSettings(kinds: [change]) }
    }

    func setCommunity(_ id: String, to level: NotificationLevel) async {
        let social = social
        await save { try social.setCommunityNotificationLevel(id, level: level) }
    }

    /// Makes a change and takes the settings back from the core, so what shows is what is stored.
    private func save(_ change: @escaping @Sendable () throws -> Void) async {
        let social = social
        do {
            settings = try await offMain {
                try change()
                return try social.notificationSettings()
            }
            problem = nil
        } catch {
            problem = Problem(error)
        }
    }
}
