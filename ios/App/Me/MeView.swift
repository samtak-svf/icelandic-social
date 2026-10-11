import PhotosUI
import SpjallCore
import SwiftUI

/// "Ég" (1e), on cream: the person and their invite link and QR code, then
/// their wall, written to from here and shown in Fljótið too. The gear at the
/// top opens `SettingsView`, which holds the rest (decision 0034).
struct MeView: View {
    let model: MeModel
    /// The person's own wall, once it is known who they are.
    let wall: PostsModel?
    let onSettings: () -> Void
    let onVerify: () -> Void
    let onReplies: (String) -> Void

    @State private var composing = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                head
                if let wall {
                    ComposerPill(placeholder: "wall_composer_placeholder") { composing = true }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                    if let problem = wall.problem {
                        ProblemCard(problem: problem) { Task { await wall.retry() } }
                            .padding(.horizontal, 16)
                            .padding(.bottom, 8)
                    }
                    // Every post here is the person's own: their name leads back here.
                    PostList(model: wall, empty: "wall_empty", onAuthor: { _ in }, onReplies: onReplies)
                        .background(BrandTokens.Colors.surface)
                }
            }
        }
        .background(BrandTokens.Colors.bg)
        .toolbar(.hidden, for: .navigationBar)
        .refreshable {
            await model.load()
            await wall?.refresh()
        }
        .sheet(isPresented: $composing) {
            if let wall {
                ComposerSheet(placeholder: "wall_composer_placeholder") { await wall.post(body: $0) }
            }
        }
        .task { await model.load() }
        .task(id: wall?.source) {
            if let wall, !wall.loaded { await wall.refresh() }
        }
    }

    private var head: some View {
        VStack(alignment: .leading, spacing: 10) {
            if model.busy {
                ProgressView().progressViewStyle(.linear)
            }
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }
            }
            if let me = model.me {
                HStack(alignment: .top) {
                    Who(name: me.name, verified: me.verified, photo: me.photoOf)
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
                PhotoControls(model: model, hasPhoto: me.photo != nil)
                if !me.verified { VerifyLink(onVerify: onVerify) }
                CardLabel(key: "invite_link_title")
                InviteCard(model: model)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The photo, or the dark circle with the initials; the name in capitals, and whether Kenni vouched for it.
private struct Who: View {
    let name: String?
    let verified: Bool
    let photo: PhotoOf?

    var body: some View {
        HStack(spacing: 14) {
            Avatar(name: name, kind: .me, size: 56, photo: photo)
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

/// Set, replace or remove the photo (decision 0039), and the one line that says who sees it: everyone
/// signed in, since it is not end-to-end encrypted. Removing asks first.
private struct PhotoControls: View {
    let model: MeModel
    let hasPhoto: Bool

    @State private var picked: PhotosPickerItem?
    @State private var removing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                PhotosPicker(selection: $picked, matching: .images) {
                    PhotoAction(text: hasPhoto ? "photo_change" : "photo_choose")
                }
                if hasPhoto {
                    Button {
                        removing = true
                    } label: {
                        PhotoAction(text: "photo_remove")
                    }
                }
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
            Task { await model.setPhoto { try await profilePhoto(photo) } }
        }
        .confirmationDialog("photo_remove_confirm", isPresented: $removing, titleVisibility: .visible) {
            Button("photo_remove", role: .destructive) { Task { await model.removePhoto() } }
            Button("cancel", role: .cancel) {}
        }
    }
}

/// The pick made small and square off the main thread; the copy of the original is deleted.
func profilePhoto(_ photo: Picked) async throws -> URL {
    let copy = try await photo.read()
    defer { try? FileManager.default.removeItem(at: copy) }
    return try await offMain { try squarePhoto(copy, side: 1024) }
}

/// One of the photo's actions: words in the text colour, as tall as a finger.
private struct PhotoAction: View {
    let text: LocalizedStringKey

    var body: some View {
        Text(text)
            .font(.sans(14, black: true))
            .foregroundStyle(BrandTokens.Colors.fg)
            .padding(.horizontal, 4)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
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
