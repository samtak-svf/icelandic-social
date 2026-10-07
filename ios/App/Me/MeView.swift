import SpjallCore
import SwiftUI

/// "Ég": the person, their invite link and QR code, their devices, the privacy
/// toggles, who they blocked, and deleting the account.
struct MeView: View {
    let model: MeModel

    @State private var revoking: String?
    @State private var deleting = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("tab_me").font(.largeTitle.bold())
                if model.busy {
                    ProgressView().progressViewStyle(.linear)
                }
                if let problem = model.problem {
                    ProblemCard(problem: problem) { Task { await model.retry() } }
                }
                if let me = model.me {
                    if let name = me.name {
                        Text(verbatim: name).font(.title2)
                    }
                    if me.verified {
                        Label("verified_with_kennitala", systemImage: "checkmark.seal.fill")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(BrandTokens.Colors.verifiedMark)
                    }
                    Divider()
                    invite
                    Divider()
                    Text("devices_title").font(.headline)
                    ForEach(me.devices, id: \.deviceId) { device in
                        DeviceRow(device: device, enabled: !model.busy) { revoking = device.deviceId }
                    }
                    if let settings = model.settings {
                        Divider()
                        PrivacySection(settings: settings, model: model)
                    }
                    Divider()
                    BlockedSection(model: model)
                    Divider()
                    Button("delete_account", role: .destructive) { deleting = true }
                        .buttonStyle(.bordered)
                        .disabled(model.busy)
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(BrandTokens.Colors.surface)
        .task { await model.load() }
        .confirmationDialog(
            "device_revoke_confirm",
            isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }),
            titleVisibility: .visible,
            presenting: revoking
        ) { deviceId in
            Button("device_revoke", role: .destructive) { Task { await model.revoke(deviceId: deviceId) } }
            Button("cancel", role: .cancel) {}
        }
        .confirmationDialog("delete_account_confirm", isPresented: $deleting, titleVisibility: .visible) {
            Button("delete_account", role: .destructive) { Task { await model.deleteAccount() } }
            Button("cancel", role: .cancel) {}
        }
    }

    @ViewBuilder private var invite: some View {
        Text("invite_link_title").font(.headline)
        Text("invite_link_hint").font(.body)
        if let link = model.link {
            QRCode(text: link)
                .frame(maxWidth: 240)
                .frame(maxWidth: .infinity)
                .accessibilityLabel(Text("invite_link_title"))
            Text(verbatim: link).font(.footnote).textSelection(.enabled)
            HStack(spacing: 8) {
                if let url = URL(string: link) {
                    ShareLink(item: url) { Text("share") }
                        .buttonStyle(.borderedProminent)
                }
                Button("invite_link_rotate") { Task { await model.newLink() } }
                    .buttonStyle(.bordered)
                    .disabled(model.busy)
            }
        } else {
            Button("invite") { Task { await model.newLink() } }
                .buttonStyle(.borderedProminent)
                .disabled(model.busy)
        }
    }
}

private struct DeviceRow: View {
    let device: AccountDevice
    let enabled: Bool
    let onRevoke: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: device.platform == .ios ? "iPhone" : "Android")
                Text(verbatim: localized("device_added", added))
                    .font(.footnote)
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                if device.current {
                    Text("device_this")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BrandTokens.Colors.primary)
                }
            }
            Spacer()
            Button("device_revoke", action: onRevoke).disabled(!enabled)
        }
    }

    private var added: String {
        Date(timeIntervalSince1970: TimeInterval(device.createdAt) / 1000)
            .formatted(date: .abbreviated, time: .omitted)
    }
}
