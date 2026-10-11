import SpjallCore
import SwiftUI

/// The conversation's menu: its information, mute or notifications back on, the disappearing timer, and
/// block in a 1:1 (decisions 0043, 0042, 0022, 0024). The information sheet offers the same choices under
/// who is here; `info` is whether it is open, so a tap on the title opens it too.
struct ConversationMenu: View {
    let conversation: Conversation
    let model: ConversationModel
    @Binding var info: Bool

    @State private var timing = false
    @State private var blocking = false

    private var other: Person? { conversation.members.count == 1 ? conversation.members[0] : nil }

    var body: some View {
        Menu {
            Button("conversation_info", systemImage: "info.circle") { info = true }
            MuteChoices(
                muted: conversation.mute != .off,
                onMute: { duration in Task { await model.mute(duration) } },
                onUnmute: { Task { await model.unmute() } })
            Button("disappearing_messages", systemImage: "timer") { timing = true }
            if other != nil {
                Button("block", systemImage: "hand.raised", role: .destructive) { blocking = true }
            }
        } label: {
            Image(systemName: "line.3.horizontal")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(BrandTokens.Colors.fg)
                .frame(minWidth: 44, minHeight: 44)
        }
        .accessibilityLabel(Text("more_options"))
        .sheet(isPresented: $info) {
            InfoSheet(conversation: conversation, model: model)
        }
        .sheet(isPresented: $timing) {
            TimerSheet(current: conversation.timer) { seconds in
                timing = false
                if seconds != conversation.timer { Task { await model.timer(seconds) } }
            }
            .presentationDetents([.medium])
        }
        .alert(
            Text(verbatim: other.map { localized("block_confirm", shownName($0)) } ?? ""),
            isPresented: $blocking
        ) {
            Button("block", role: .destructive) { Task { await model.block() } }
            Button("cancel", role: .cancel) {}
        }
    }
}

/// Mute with its three durations, or notifications back on (decision 0042): in the conversation's menu and
/// in the list row's long-press menu (decision 0043), the same choices in both.
struct MuteChoices: View {
    let muted: Bool
    let onMute: (MuteFor) -> Void
    let onUnmute: () -> Void

    var body: some View {
        if muted {
            Button("unmute", systemImage: "bell") { onUnmute() }
        } else {
            Menu("mute", systemImage: "bell.slash") {
                Button("mute_hour") { onMute(.hour) }
                Button("mute_eight_hours") { onMute(.eightHours) }
                Button("mute_always") { onMute(.always) }
            }
        }
    }
}

/// Who is in the conversation, then the menu's choices, the timer showing what it is set to (decision 0043).
private struct InfoSheet: View {
    let conversation: Conversation
    let model: ConversationModel

    @State private var blocking = false
    @Environment(\.dismiss) private var dismiss

    private var other: Person? { conversation.members.count == 1 ? conversation.members[0] : nil }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(conversation.members, id: \.account) { person in
                        HStack(spacing: 12) {
                            Avatar(person: person, size: 36)
                            Text(verbatim: shownName(person)).foregroundStyle(BrandTokens.Colors.fg)
                            if person.verified { VerifiedMark() }
                        }
                        .accessibilityElement(children: .combine)
                    }
                } header: {
                    if conversation.members.count > 1 {
                        Text(verbatim: plural("group_member_count", conversation.members.count))
                    }
                }
                Section {
                    NavigationLink {
                        TimerList(current: conversation.timer) { seconds in
                            if seconds != conversation.timer { Task { await model.timer(seconds) } }
                            dismiss()
                        }
                        .navigationTitle(Text("disappearing_messages"))
                        .navigationBarTitleDisplayMode(.inline)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("disappearing_messages")
                            Text(verbatim: timerLine(conversation.timer))
                                .font(.footnote)
                                .foregroundStyle(BrandTokens.Colors.mutedFg)
                        }
                    }
                    MuteChoices(
                        muted: conversation.mute != .off,
                        onMute: { duration in pick { await model.mute(duration) } },
                        onUnmute: { pick { await model.unmute() } })
                    if other != nil {
                        Button("block", role: .destructive) { blocking = true }
                    }
                }
                .foregroundStyle(BrandTokens.Colors.fg)
            }
            .scrollContentBackground(.hidden)
            .background(BrandTokens.Colors.surface)
            .navigationTitle(Text("conversation_info"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("cancel") { dismiss() } }
            }
            .alert(
                Text(verbatim: other.map { localized("block_confirm", shownName($0)) } ?? ""),
                isPresented: $blocking
            ) {
                Button("block", role: .destructive) { pick { await model.block() } }
                Button("cancel", role: .cancel) {}
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// Closes the sheet and does what was picked.
    private func pick(_ action: @escaping @MainActor () async -> Void) {
        dismiss()
        Task { await action() }
    }
}

/// What the timer is set to, as its choices name it.
private func timerLine(_ seconds: UInt32?) -> String {
    seconds.map { localized("disappearing_option", duration($0)) } ?? localized("disappearing_off")
}

/// Off, or one of the timers decision 0022 lists.
private struct TimerSheet: View {
    let current: UInt32?
    let onPick: (UInt32?) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TimerList(current: current, onPick: onPick)
                .navigationTitle(Text("disappearing_messages"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("cancel") { dismiss() } }
                }
        }
    }
}

/// The timer's choices, the one set ticked.
private struct TimerList: View {
    /// One hour, one day, seven days and thirty days, in seconds.
    static let timers: [UInt32?] = [nil, 3_600, 86_400, 604_800, 2_592_000]

    let current: UInt32?
    let onPick: (UInt32?) -> Void

    var body: some View {
        List(Self.timers, id: \.self) { seconds in
            Button {
                onPick(seconds)
            } label: {
                HStack {
                    Text(verbatim: timerLine(seconds))
                    Spacer()
                    if seconds == current { Image(systemName: "checkmark").accessibilityHidden(true) }
                }
            }
            .foregroundStyle(BrandTokens.Colors.fg)
            .accessibilityAddTraits(seconds == current ? .isSelected : [])
        }
        .scrollContentBackground(.hidden)
        .background(BrandTokens.Colors.surface)
    }
}
