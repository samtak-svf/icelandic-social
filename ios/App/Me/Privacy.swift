import SpjallCore
import SwiftUI

/// The read-marker and typing toggles (decision 0022): off stops both sending and seeing.
struct PrivacySection: View {
    let settings: Settings
    let model: MeModel

    var body: some View {
        Setting(
            text: "read_receipts_setting", hint: "read_receipts_hint",
            isOn: Binding(get: { settings.readMarkers }, set: { on in Task { await model.readMarkers(on) } }),
            enabled: !model.busy)
        Hairline()
        Setting(
            text: "typing_setting", hint: nil,
            isOn: Binding(get: { settings.typing }, set: { on in Task { await model.typing(on) } }),
            enabled: !model.busy)
    }
}

/// One toggle in a card, red when on as the design's switches.
private struct Setting: View {
    let text: LocalizedStringKey
    let hint: LocalizedStringKey?
    let isOn: Binding<Bool>
    let enabled: Bool

    var body: some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 2) {
                Text(text)
                    .font(.sans(14, black: true))
                    .foregroundStyle(BrandTokens.Colors.fg)
                if let hint {
                    Text(hint)
                        .font(.sans(12, relativeTo: .footnote))
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                }
            }
        }
        .tint(BrandTokens.Colors.primary)
        .disabled(!enabled)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }
}

/// Who this account blocked (decision 0024), newest first; unblock asks first.
/// The caller gives it its title.
struct BlockedSection: View {
    let model: MeModel

    @State private var unblocking: Person?

    var body: some View {
        Group {
            if model.blocked.isEmpty {
                Text("blocked_empty")
                    .font(.sans(13))
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                    .padding(14)
            }
            ForEach(Array(model.blocked.enumerated()), id: \.element.account) { index, person in
                if index > 0 { Hairline() }
                HStack(spacing: 6) {
                    Text(verbatim: shownName(person))
                        .font(.sans(14, black: true))
                        .foregroundStyle(BrandTokens.Colors.fg)
                    if person.verified { VerifiedMark() }
                    Spacer()
                    Button {
                        unblocking = person
                    } label: {
                        Text("unblock")
                            .font(.sans(12, black: true))
                            .foregroundStyle(BrandTokens.Colors.primary)
                            .padding(.horizontal, 10)
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .disabled(model.busy)
                }
                .padding(.leading, 14)
                .padding(.trailing, 4)
                .padding(.vertical, 4)
            }
        }
        .alert(
            Text(verbatim: unblocking.map { localized("unblock_confirm", shownName($0)) } ?? ""),
            isPresented: Binding(get: { unblocking != nil }, set: { if !$0 { unblocking = nil } }),
            presenting: unblocking
        ) { person in
            Button("unblock") { Task { await model.unblock(person.account) } }
            Button("cancel", role: .cancel) {}
        }
    }
}
