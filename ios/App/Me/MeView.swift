import SpjallCore
import SwiftUI

/// "Ég" (1e), on cream: the person, their invite link and QR code, their
/// devices, the read-marker and typing toggles, who they blocked, and
/// deleting the account. While the system blocks the app's notifications, a
/// notice under the devices says so.
struct MeView: View {
    let model: MeModel
    let push: PushModel

    @State private var revoking: String?
    @State private var deleting = false

    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if model.busy {
                    ProgressView().progressViewStyle(.linear)
                }
                if let problem = model.problem {
                    ProblemCard(problem: problem) { Task { await model.retry() } }
                }
                if let me = model.me {
                    Who(name: me.name, verified: me.verified)
                    CardLabel(key: "invite_link_title")
                    InviteCard(model: model)
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
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(BrandTokens.Colors.bg)
        .task { await model.load() }
        .task { await push.check() }
        // Back from the settings the notice sends to.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await push.check() } }
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

/// The dark circle with the initials, the name in capitals, and whether Kenni vouched for it.
private struct Who: View {
    let name: String?
    let verified: Bool

    var body: some View {
        HStack(spacing: 14) {
            Avatar(name: name, kind: .me, size: 56)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if let name {
                        Text(verbatim: name.capitals)
                            .font(TypeStyle.accountName)
                            .foregroundStyle(BrandTokens.Colors.fg)
                            .accessibilityAddTraits(.isHeader)
                    }
                    if verified { VerifiedMark(size: 8) }
                }
                if verified { SectionLabel(text: localized("verified_with_kennitala")) }
            }
        }
        .padding(.vertical, 8)
    }
}

/// Small capitals over a card.
private struct CardLabel: View {
    let key: String

    var body: some View {
        SectionLabel(text: localized(key))
            .padding(.leading, 4)
            .padding(.top, 8)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A white rounded card on the cream.
struct Panel<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(BrandTokens.Colors.surface, in: RoundedRectangle(cornerRadius: 18))
            .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(BrandTokens.Colors.border, lineWidth: 1) }
    }
}

/// The line between rows of a card.
struct Hairline: View {
    var body: some View {
        Rectangle().fill(BrandTokens.Colors.border).frame(height: 1)
    }
}

/// The QR code beside the hint, then share and a new link side by side. The link itself stays out of sight.
private struct InviteCard: View {
    let model: MeModel

    var body: some View {
        Panel {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 14) {
                    if let link = model.link {
                        QRCode(text: link)
                            .padding(6)
                            .frame(width: 104, height: 104)
                            .overlay {
                                RoundedRectangle(cornerRadius: 12).strokeBorder(BrandTokens.Colors.border, lineWidth: 1)
                            }
                            .accessibilityElement()
                            .accessibilityLabel(Text("invite_link_title"))
                    }
                    Text("invite_link_hint")
                        .font(.sans(12.5, relativeTo: .subheadline))
                        .lineSpacing(3)
                        .foregroundStyle(BrandTokens.Colors.fg)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if let link = model.link, let url = URL(string: link) {
                    Weighted(weights: [1, 1.4], spacing: 8) {
                        ShareLink(item: url) { PillLabel(text: "share", filled: true) }
                            .buttonStyle(.plain)
                        Button {
                            Task { await model.newLink() }
                        } label: {
                            PillLabel(text: "invite_link_rotate", filled: false)
                        }
                        .buttonStyle(.plain)
                        .disabled(model.busy)
                    }
                } else {
                    Button {
                        Task { await model.newLink() }
                    } label: {
                        PillLabel(text: "invite", filled: true)
                    }
                    .buttonStyle(.plain)
                    .disabled(model.busy)
                }
            }
            .padding(14)
        }
    }
}

/// Its children side by side, the width shared out by `weights`.
private struct Weighted: Layout {
    let weights: [CGFloat]
    let spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width =
            proposal.width
            ?? subviews.map { $0.sizeThatFits(.unspecified).width }.reduce(0, +) + spacing
            * CGFloat(max(0, subviews.count - 1))
        let heights = zip(subviews, widths(width, subviews.count)).map {
            $0.sizeThatFits(ProposedViewSize(width: $1, height: nil)).height
        }
        return CGSize(width: width, height: heights.max() ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        for (subview, width) in zip(subviews, widths(bounds.width, subviews.count)) {
            subview.place(
                at: CGPoint(x: x, y: bounds.minY), proposal: ProposedViewSize(width: width, height: bounds.height))
            x += width + spacing
        }
    }

    private func widths(_ width: CGFloat, _ count: Int) -> [CGFloat] {
        let shares = weights.prefix(count)
        let total = shares.reduce(0, +)
        let free = max(0, width - spacing * CGFloat(max(0, count - 1)))
        return shares.map { total > 0 ? free * $0 / total : 0 }
    }
}

/// A round-ended button face: filled red, or white with a border.
private struct PillLabel: View {
    let text: LocalizedStringKey
    let filled: Bool

    var body: some View {
        Text(text)
            .font(.sans(12.5, black: true))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .foregroundStyle(filled ? BrandTokens.Colors.primaryFg : BrandTokens.Colors.fg)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(filled ? BrandTokens.Colors.primary : BrandTokens.Colors.surface, in: Capsule())
            .overlay {
                if !filled { Capsule().strokeBorder(BrandTokens.Colors.borderStrong, lineWidth: 1) }
            }
            .contentShape(Capsule())
    }
}

/// Notifications are off: nothing new shows until the app is opened.
private struct NotificationsOff: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "bell.slash")
                .font(.system(size: 16))
                .foregroundStyle(BrandTokens.Colors.fg)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text("notifications_off")
                    .font(.sans(12.5, relativeTo: .subheadline))
                    .foregroundStyle(BrandTokens.Colors.fg)
                Button {
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                } label: {
                    Text("notifications_settings")
                        .font(.sans(13.5, black: true))
                        .foregroundStyle(BrandTokens.Colors.primary)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .padding(.bottom, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandTokens.Colors.secondarySubtle, in: RoundedRectangle(cornerRadius: 14))
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
