import SpjallCore
import SwiftUI

/// The read-marker and typing toggles (decision 0022): off stops both sending and seeing.
struct PrivacySection: View {
    let settings: Settings
    let model: MeModel

    var body: some View {
        Toggle(
            isOn: Binding(get: { settings.readMarkers }, set: { on in Task { await model.readMarkers(on) } })
        ) {
            VStack(alignment: .leading, spacing: 2) {
                Text("read_receipts_setting")
                Text("read_receipts_hint").font(.footnote).foregroundStyle(BrandTokens.Colors.mutedFg)
            }
        }
        .disabled(model.busy)
        Toggle(
            "typing_setting", isOn: Binding(get: { settings.typing }, set: { on in Task { await model.typing(on) } })
        )
        .disabled(model.busy)
    }
}

/// Who this account blocked (decision 0024), newest first; unblock asks first.
struct BlockedSection: View {
    let model: MeModel

    @State private var unblocking: Person?

    var body: some View {
        Text("blocked_title").font(.headline)
        if model.blocked.isEmpty {
            Text("blocked_empty").font(.subheadline).foregroundStyle(BrandTokens.Colors.mutedFg)
        }
        ForEach(model.blocked, id: \.account) { person in
            HStack(spacing: 4) {
                Text(verbatim: shownName(person))
                if person.verified { VerifiedMark() }
                Spacer()
                Button("unblock") { unblocking = person }.disabled(model.busy)
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
