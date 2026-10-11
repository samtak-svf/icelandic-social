import SpjallCore
import SwiftUI

/// The settings on Ég, under the profile (decision 0044): the account's devices,
/// the read-marker and typing toggles, who the person blocked, and deleting the
/// account. While the system blocks the app's notifications, a notice under
/// the devices says so.
struct SettingsSection: View {
    let model: MeModel
    let me: Me
    let notificationsOff: Bool

    @State private var revoking: String?
    @State private var deleting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CardLabel(key: "devices_title")
            Panel {
                ForEach(Array(me.devices.enumerated()), id: \.element.deviceId) { index, device in
                    if index > 0 { Hairline() }
                    DeviceRow(device: device, enabled: !model.busy) { revoking = device.deviceId }
                }
            }
            if notificationsOff {
                NotificationsOff()
            }
            // The design leaves these out; decision 0009 keeps them, in the same cards.
            if let settings = model.settings {
                Panel { PrivacySection(settings: settings, model: model) }
            }
            CardLabel(key: "blocked_title")
            Panel { BlockedSection(model: model) }
            Button {
                deleting = true
            } label: {
                Text("delete_account")
                    .font(.sans(13.5, black: true))
                    .foregroundStyle(BrandTokens.Colors.danger)
                    .frame(minHeight: 44)
            }
            .disabled(model.busy)
            .frame(maxWidth: .infinity)
        }
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
}

/// The app's and the core's versions, last on Ég.
struct VersionLine: View {
    private static let version = info("CFBundleShortVersionString")
    private static let build = info("CFBundleVersion")

    private static func info(_ key: String) -> String {
        Bundle.main.object(forInfoDictionaryKey: key) as? String ?? "-"
    }

    var body: some View {
        Text(verbatim: localized("app_version", Self.version, Self.build, coreVersion()))
            .font(.caption)
            .foregroundStyle(BrandTokens.Colors.mutedFg)
            .frame(maxWidth: .infinity)
    }
}

private struct DeviceRow: View {
    let device: AccountDevice
    let enabled: Bool
    let onRevoke: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "iphone")
                .font(.system(size: 16))
                .foregroundStyle(BrandTokens.Colors.fg)
                .frame(width: 30, height: 30)
                .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: device.platform == .ios ? "iPhone" : "Android")
                    .font(.sans(14.5, black: true))
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .lineLimit(1)
                Text(verbatim: localized("device_added", calendarDate(device.createdAt)))
                    .font(.sans(12, relativeTo: .footnote))
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if device.current {
                Text(verbatim: localized("device_this").capitals)
                    .font(.sans(9.5, black: true, relativeTo: .caption2))
                    .tracking(0.95)
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(BrandTokens.Colors.secondarySubtle, in: Capsule())
            }
            // The current device too: revoking it is how this phone signs out.
            Button(action: onRevoke) {
                Text("device_revoke")
                    .font(.sans(12, black: true))
                    .foregroundStyle(BrandTokens.Colors.primary)
                    .padding(.horizontal, 10)
                    .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
            .disabled(!enabled)
        }
        .padding(.leading, 14)
        .padding(.trailing, 4)
        .padding(.vertical, 10)
    }
}
