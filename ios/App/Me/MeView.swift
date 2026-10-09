import SpjallCore
import SwiftUI

/// "Ég" (1e), on cream: the person and their invite link and QR code. The
/// gear at the top opens `SettingsView`, which holds the rest (decision 0034).
struct MeView: View {
    let model: MeModel
    let onSettings: () -> Void
    let onVerify: () -> Void

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
                    HStack(alignment: .top) {
                        Who(name: me.name, verified: me.verified)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button(action: onSettings) {
                            Image(systemName: "gearshape")
                                .font(.system(size: 20))
                                .foregroundStyle(BrandTokens.Colors.fg)
                                .frame(minWidth: 44, minHeight: 44)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("settings_title"))
                    }
                    if !me.verified { VerifyLink(onVerify: onVerify) }
                    CardLabel(key: "invite_link_title")
                    InviteCard(model: model)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(BrandTokens.Colors.bg)
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.load() }
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
