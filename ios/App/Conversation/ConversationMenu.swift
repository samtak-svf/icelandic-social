import SpjallCore
import SwiftUI

/// Mute with its three durations, or notifications back on (decision 0042), in the list row's
/// long-press menu (decision 0043).
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

/// What the timer is set to, as its choices name it (the information screen's row, decision 0055).
func timerLine(_ seconds: UInt32?) -> String {
    seconds.map { localized("disappearing_option", duration($0)) } ?? localized("disappearing_off")
}

/// Off, or one of the timers decision 0022 lists; the information screen opens it (decision 0055).
struct TimerSheet: View {
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
