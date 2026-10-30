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
    /// Community names by id, for the notification levels set per community.
    let communityNames: [String: String]
    let onVerify: () -> Void
    let onLink: () -> Void
    let onStatements: () -> Void

    /// What the photo picker chose, from the circle or from the words under it.
    @State private var picked: PhotosPickerItem?

    var body: some View {
        // The title stays in its band and the rest scrolls under it (0053), as on the list.
        VStack(spacing: 0) {
            ScreenHeader(title: localized("tab_me"))
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
                    Who(me: me, picked: $picked, enabled: !model.busy)
                    PhotoControls(model: model, hasPhoto: me.photo != nil, picked: $picked)
                    if !me.verified { VerifyLink(onVerify: onVerify) }
                    CardLabel(key: "invite_link_title")
                    InviteCard(model: model)
                    SettingsSection(
                        model: model, me: me, notificationsOff: push.off, levels: levels,
                        communityNames: communityNames, onLink: onLink, onStatements: onStatements)
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
    @Binding var picked: PhotosPickerItem?
    let enabled: Bool

    private var name: String? { me.name }
    private var verified: Bool { me.verified }

    var body: some View {
        HStack(spacing: 14) {
            PhotosPicker(selection: $picked, matching: .images) {
                Avatar(name: name, kind: .me, size: 72, photo: me.photoOf)
            }
            .buttonStyle(.plain)
            .disabled(!enabled)
            .accessibilityLabel(Text(me.photo == nil ? "photo_choose" : "photo_change"))
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

/// Set, replace or remove the photo (decision 0039), and the one line that says who sees it: everyone
/// signed in, since it is not end-to-end encrypted. Removing asks first.
private struct PhotoControls: View {
    let model: MeModel
    let hasPhoto: Bool
    @Binding var picked: PhotosPickerItem?

    @State private var removing = false
    @State private var framing: FrameRequest?

    @ViewBuilder private var pills: some View {
        PhotosPicker(selection: $picked, matching: .images) {
            PillLabel(text: hasPhoto ? "photo_change" : "photo_choose", filled: false, wide: false)
        }
        if hasPhoto {
            Button {
                Task { await reframe() }
            } label: {
                PillLabel(text: "image_frames_title", filled: false, wide: false)
            }
            Button {
                removing = true
            } label: {
                PillLabel(text: "photo_remove", filled: false, wide: false)
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Outlined pills, as the invite card's buttons are, so they read as buttons (decision 0047). Side
            // by side, and one under the other when a large font leaves no room.
            ViewThatFits {
                HStack(spacing: 8) { pills }
                VStack(alignment: .leading, spacing: 8) { pills }
            }
            .buttonStyle(.plain)
            .disabled(model.busy)
            Text("photo_seen_by_all")
                .font(.sans(12.5, relativeTo: .subheadline))
                .foregroundStyle(BrandTokens.Colors.fg)
                .padding(.horizontal, 4)
        }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            picked = nil
            let photo = Picked(photo: item)
            Task { await startFraming(photo) }
        }
        .frameSheet($framing)
        .confirmationDialog("photo_remove_confirm", isPresented: $removing, titleVisibility: .visible) {
            Button("photo_remove", role: .destructive) { Task { await model.removePhoto() } }
            Button("cancel", role: .cancel) {}
        }
    }
}

extension PhotoControls {
    /// A new pick goes to the crop sheet first; Save uploads the master, then the framing (decision 0086). The
    /// upload makes its own master from the pick, so trying again after a failure still has one.
    fileprivate func startFraming(_ photo: Picked) async {
        guard let master = try? await masterFile(photo) else {
            await model.setPhoto { try await masterFile(photo) }
            return
        }
        framing = FrameRequest(kind: .photo, master: master, start: nil) { framing in
            try? FileManager.default.removeItem(at: master)
            guard let framing else { return }
            Task { await model.setPhoto({ try await masterFile(photo) }, framing: framing) }
        }
    }

    /// The photo already set, framed again from the master the server kept.
    fileprivate func reframe() async {
        guard let found = await model.photoMaster() else { return }
        framing = FrameRequest(kind: .photo, master: found.file, start: found.framing) { framing in
            try? FileManager.default.removeItem(at: found.file)
            guard let framing else { return }
            Task { await model.reframePhoto(framing) }
        }
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
                            .background(.white, in: RoundedRectangle(cornerRadius: 12))
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
