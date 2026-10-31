import PhotosUI
import SpjallCore
import SwiftUI

/// "Ég" (1e), on cream: the account's profile and settings (decision 0044). The
/// person, their photo and their invite link and QR code, then `SettingsSection`: the
/// devices, the toggles, who they blocked, and deleting the account.
struct MeView: View {
    let model: MeModel
    let push: PushModel
    let levels: NotificationLevelsModel
    let suggestions: SuggestionSettingsModel
    /// Community names by id, for the notification levels set per community.
    let communityNames: [String: String]
    let onVerify: () -> Void
    let onLink: () -> Void
    let onStatements: () -> Void
    let onFriends: () -> Void
    /// Set when the settings are pushed over the wall: the back control before the title (decision 0115).
    var onBack: (() -> Void)?

    var body: some View {
        // The title stays in its band and the rest scrolls under it (0053), as on the list.
        VStack(spacing: 0) {
            ScreenHeader(title: localized("settings_title"), back: onBack) { EmptyView() }
            content
        }
        .background(BrandTokens.Colors.bg)
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.load() }
        .task { await push.check() }
    }

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if model.busy {
                    ProgressView().progressViewStyle(.linear)
                }
                if let problem = model.problem {
                    ProblemCard(problem: problem) { Task { await model.retry() } }
                }
                if let me = model.me {
                    Who(me: me)
                    if !me.verified { VerifyLink(onVerify: onVerify) }
                    CardLabel(key: "invite_link_title")
                    InviteCard(model: model)
                    SettingsSection(
                        model: model, me: me, notificationsOff: push.off, levels: levels,
                        suggestions: suggestions,
                        communityNames: communityNames, onLink: onLink, onStatements: onStatements,
                        onFriends: onFriends)
                }
                VersionLine()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .refreshable { await model.load() }
    }
}

/// The photo, or the dark circle with the initials; the name as it is written, in the account-name size
/// (decision 0047), and whether Kenni vouched for it.
/// A tap on the circle opens the photo picker, as the words under it do (decision 0043).
private struct Who: View {
    let me: Me

    private var name: String? { me.name }
    private var verified: Bool { me.verified }

    var body: some View {
        HStack(spacing: 14) {
            Avatar(name: name, kind: .me, size: 72, photo: me.photoOf)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if let name {
                        Text(verbatim: name)
                            .font(TypeStyle.accountName)
                            .foregroundStyle(BrandTokens.Colors.fg)
                            .accessibilityAddTraits(.isHeader)
                    }
                    if verified { VerifiedMark(size: 18) }
                }
                if verified { SectionLabel(text: localized("verified_with_kennitala")) }
            }
        }
        .padding(.vertical, 8)
    }
}

/// Small capitals over a card.
struct CardLabel: View {
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
            .background(BrandTokens.Colors.surface, in: RoundedRectangle(cornerRadius: BrandTokens.Radius.bubble))
            .overlay {
                RoundedRectangle(cornerRadius: BrandTokens.Radius.bubble).strokeBorder(
                    BrandTokens.Colors.border, lineWidth: 1)
            }
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
                            .background(.white, in: RoundedRectangle(cornerRadius: BrandTokens.Radius.pane))
                            .frame(width: 104, height: 104)
                            .overlay {
                                RoundedRectangle(cornerRadius: BrandTokens.Radius.pane).strokeBorder(
                                    BrandTokens.Colors.border, lineWidth: 1)
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
                    // Side by side, and one under the other when a large font leaves no room.
                    ViewThatFits {
                        Weighted(weights: [1, 1.4], spacing: 8) { linkButtons(url) }
                        VStack(spacing: 8) { linkButtons(url) }
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

    @ViewBuilder private func linkButtons(_ url: URL) -> some View {
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
}

/// Its children side by side, the width shared out by `weights`.
private struct Weighted: Layout {
    let weights: [CGFloat]
    let spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? idealWidth(subviews)
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

    /// The width at which every child gets at least its own ideal width from its share, so that a
    /// `ViewThatFits` around this tries the next layout as soon as one child would be cut.
    private func idealWidth(_ subviews: Subviews) -> CGFloat {
        let shares = Array(weights.prefix(subviews.count))
        let total = shares.reduce(0, +)
        var free: CGFloat = 0
        for (subview, share) in zip(subviews, shares) where share > 0 {
            free = max(free, subview.sizeThatFits(.unspecified).width * total / share)
        }
        return free + spacing * CGFloat(max(0, subviews.count - 1))
    }

    private func widths(_ width: CGFloat, _ count: Int) -> [CGFloat] {
        let shares = weights.prefix(count)
        let total = shares.reduce(0, +)
        let free = max(0, width - spacing * CGFloat(max(0, count - 1)))
        return shares.map { total > 0 ? free * $0 / total : 0 }
    }
}

/// A round-ended button face: filled red, or white with a border. `wide` takes the width offered; otherwise
/// it is as wide as its words.
struct PillLabel: View {
    let text: LocalizedStringKey
    let filled: Bool
    var wide = true

    var body: some View {
        Text(text)
            .font(.sans(12.5, black: true))
            .multilineTextAlignment(.center)
            .foregroundStyle(filled ? BrandTokens.Colors.primaryFg : BrandTokens.Colors.fg)
            .padding(.horizontal, wide ? 12 : 16)
            .frame(maxWidth: wide ? .infinity : nil, minHeight: 40)
            .background(filled ? BrandTokens.Colors.primary : BrandTokens.Colors.surface, in: Capsule())
            .overlay {
                if !filled { Capsule().strokeBorder(BrandTokens.Colors.borderStrong, lineWidth: 1) }
            }
            .contentShape(Capsule())
    }
}
