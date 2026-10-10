import SpjallCore
import SwiftUI

/// The settings behind Ég's gear (decision 0034): the account's devices, the
/// read-marker and typing toggles, who the person blocked, and deleting the
/// account. While the system blocks the app's notifications, a notice under
/// the devices says so.
struct SettingsView: View {
    let model: MeModel
    let push: PushModel
    let onVerify: () -> Void

    @State private var revoking: String?
    @State private var deleting = false

    var body: some View {
        VStack(spacing: 0) {
            Header()
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if model.busy {
                        ProgressView().progressViewStyle(.linear)
                    }
                    if let problem = model.problem {
                        ProblemCard(problem: problem) { Task { await model.retry() } }
                    }
                    if let me = model.me {
                        if !me.verified { VerifyLink(onVerify: onVerify) }
                        CardLabel(key: "devices_title")
                        Panel {
                            ForEach(Array(me.devices.enumerated()), id: \.element.deviceId) { index, device in
                                if index > 0 { Hairline() }
                                DeviceRow(device: device, enabled: !model.busy) { revoking = device.deviceId }
                            }
                        }
                        if push.off {
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
                    Text(verbatim: localized("app_version", Self.version, Self.build, coreVersion()))
                        .font(.caption)
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                        .frame(maxWidth: .infinity)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .background(BrandTokens.Colors.bg)
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.load() }
        .task { await push.check() }
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

extension SettingsView {
    private static let version = info("CFBundleShortVersionString")
    private static let build = info("CFBundleVersion")

    private static func info(_ key: String) -> String {
        Bundle.main.object(forInfoDictionaryKey: key) as? String ?? "-"
    }
}

/// The back arrow and the screen's title.
private struct Header: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        HStack(spacing: 4) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("back"))
            Text(verbatim: localized("settings_title").capitals)
                .font(TypeStyle.screenTitle)
                .foregroundStyle(BrandTokens.Colors.fg)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
        }
        .padding(.leading, 4)
        .padding(.trailing, 16)
        .padding(.vertical, 4)
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
