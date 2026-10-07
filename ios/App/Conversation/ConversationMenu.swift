import SpjallCore
import SwiftUI

/// The conversation's menu: the disappearing timer, and block in a 1:1 (decisions 0022, 0024).
struct ConversationMenu: View {
    let conversation: Conversation
    let model: ConversationModel

    @State private var timing = false
    @State private var blocking = false

    private var other: Person? { conversation.members.count == 1 ? conversation.members[0] : nil }

    var body: some View {
        Menu {
            Button("disappearing_messages", systemImage: "timer") { timing = true }
            if other != nil {
                Button("block", systemImage: "hand.raised", role: .destructive) { blocking = true }
            }
        } label: {
            Image(systemName: "ellipsis.circle").frame(minWidth: 44, minHeight: 44)
        }
        .accessibilityLabel(Text("more_options"))
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

/// Off, or one of the timers decision 0022 lists.
private struct TimerSheet: View {
    /// One hour, one day, seven days and thirty days, in seconds.
    static let timers: [UInt32?] = [nil, 3_600, 86_400, 604_800, 2_592_000]

    let current: UInt32?
    let onPick: (UInt32?) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(Self.timers, id: \.self) { seconds in
                Button {
                    onPick(seconds)
                } label: {
                    HStack {
                        Text(
                            verbatim: seconds.map { localized("disappearing_option", duration($0)) }
                                ?? localized("disappearing_off"))
                        Spacer()
                        if seconds == current { Image(systemName: "checkmark").accessibilityHidden(true) }
                    }
                }
                .foregroundStyle(BrandTokens.Colors.fg)
                .accessibilityAddTraits(seconds == current ? .isSelected : [])
            }
            .scrollContentBackground(.hidden)
            .background(BrandTokens.Colors.surface)
            .navigationTitle(Text("disappearing_messages"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("cancel") { dismiss() } }
            }
        }
    }
}
