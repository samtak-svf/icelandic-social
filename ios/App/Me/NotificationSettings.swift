import SpjallCore
import SwiftUI

/// The words for a level, from the generated strings.
func levelLabel(_ level: NotificationLevel) -> String {
    switch level {
    case .push: localized("notification_level_push")
    case .inApp: localized("notification_level_in_app")
    case .off: localized("notification_level_off")
    }
}

/// The words for a kind of notification.
func kindLabel(_ kind: SocialNotificationKind) -> String {
    switch kind {
    case .comment: localized("notification_kind_comment")
    case .reply: localized("notification_kind_reply")
    case .reaction: localized("notification_kind_reaction")
    case .joinApproved: localized("notification_kind_join_approved")
    case .moderated: localized("notification_kind_moderated")
    }
}

/// One level picker, as a menu showing the chosen level.
struct LevelPicker: View {
    let title: String
    let choices: [NotificationLevel]
    let selection: NotificationLevel
    let onChange: (NotificationLevel) -> Void

    var body: some View {
        HStack(spacing: 8) {
            Text(verbatim: title)
                .font(.sans(14, black: true))
                .foregroundStyle(BrandTokens.Colors.fg)
                .frame(maxWidth: .infinity, alignment: .leading)
            Picker(
                title, selection: Binding(get: { selection }, set: { onChange($0) })
            ) {
                ForEach(choices, id: \.self) { level in Text(verbatim: levelLabel(level)).tag(level) }
            }
            .pickerStyle(.menu)
            .tint(BrandTokens.Colors.primary)
            .labelsHidden()
            .accessibilityLabel(Text(verbatim: title))
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 48)
    }
}

/// Settings, notifications (decision 0106): a level for each kind, the floor under a moderator's actions, then
/// the communities with a level of their own.
struct NotificationSettingsSection: View {
    let levels: NotificationLevelsModel
    /// Community names by id, from the hub's cache.
    let names: [String: String]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CardLabel(key: "notification_settings_title")
            Text("notification_settings_body")
                .font(.sans(13, relativeTo: .footnote))
                .foregroundStyle(BrandTokens.Colors.mutedFg)
            if levels.settings != nil {
                Panel {
                    ForEach(Array(NotificationLevelsModel.kinds.enumerated()), id: \.element) { index, kind in
                        if index > 0 { Hairline() }
                        LevelPicker(
                            title: kindLabel(kind), choices: NotificationLevelsModel.choices(for: kind),
                            selection: levels.level(of: kind)
                        ) { level in Task { await levels.set(kind, to: level) } }
                    }
                    Hairline()
                    Text("notification_moderated_floor")
                        .font(.sans(12, relativeTo: .footnote))
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                }
                if !levels.communityLevels.isEmpty {
                    CardLabel(key: "notification_settings_communities")
                    Panel {
                        ForEach(Array(levels.communityLevels.enumerated()), id: \.element.communityId) { index, entry in
                            if index > 0 { Hairline() }
                            LevelPicker(
                                title: names[entry.communityId] ?? entry.communityId,
                                choices: [.push, .inApp, .off], selection: entry.level
                            ) { level in Task { await levels.setCommunity(entry.communityId, to: level) } }
                        }
                    }
                }
            } else if let problem = levels.problem {
                ProblemCard(problem: problem) { Task { await levels.load() } }
            }
        }
        .task { await levels.load() }
    }
}

/// A community's own level, on its screen: how its posts and comments notify this account.
struct CommunityLevelPicker: View {
    let communityId: String
    @State private var levels: NotificationLevelsModel

    init(communityId: String, social: Social) {
        self.communityId = communityId
        _levels = State(initialValue: NotificationLevelsModel(social: social))
    }

    var body: some View {
        Group {
            if levels.settings != nil {
                Panel {
                    LevelPicker(
                        title: localized("notification_settings_title"), choices: [.push, .inApp, .off],
                        selection: levels.level(ofCommunity: communityId)
                    ) { level in Task { await levels.setCommunity(communityId, to: level) } }
                }
            }
        }
        .task { await levels.load() }
    }
}
