import SwiftUI
import UIKit

/// What `Deila` on a post needs from the app (decision 0080): the conversation picker that sends the post as a
/// card, which needs the account and the live connection the communities' client does not have. Set on the
/// communities' stacks; nil leaves the post with its link alone.
struct PostSharing {
    /// The picker that sends the post `postId` into the conversations picked.
    let picker: @MainActor (String) -> PickModel
}

private struct PostSharingKey: EnvironmentKey {
    static var defaultValue: PostSharing? { nil }
}

extension EnvironmentValues {
    var postSharing: PostSharing? {
        get { self[PostSharingKey.self] }
        set { self[PostSharingKey.self] = newValue }
    }
}

/// The web app's origin this build names (Info.plist `SpjallWebHost`, from identifiers/ids.json `hosts.web`).
let webOrigin = "https://" + (Bundle.main.object(forInfoDictionaryKey: "SpjallWebHost") as? String ?? "")

/// The address of a post on the web (the route `posts/$postId`), which the app opens as well.
func postLink(_ postId: String, origin: String = webOrigin) -> String { "\(origin)/posts/\(postId)" }

/// Puts `link` on the pasteboard, for this device alone.
@MainActor func copyLink(_ link: String) {
    UIPasteboard.general.setItems([["public.utf8-plain-text": link]], options: [.localOnly: true])
}

extension View {
    /// `Deila` on a post: a sheet offering `Senda í samtal` and `Afrita tengil`, presented while `postId` is set.
    func sharingPost(_ postId: Binding<String?>) -> some View {
        modifier(PostSharingModifier(postId: postId))
    }
}

private struct PostSharingModifier: ViewModifier {
    @Binding var postId: String?

    @Environment(\.postSharing) private var sharing
    @State private var picker: PickModel?
    @State private var notice: String?

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: Binding(get: { postId != nil }, set: { if !$0 { postId = nil } })) {
                if let id = postId {
                    ShareOptions(
                        canSend: sharing != nil,
                        onSend: { send(id) },
                        onCopy: { copy(id) }
                    )
                    .presentationDetents([.height(220)])
                }
            }
            .sheet(isPresented: Binding(get: { picker != nil }, set: { if !$0 { picker = nil } })) {
                if let picker {
                    SharePick(model: picker, onClose: { self.picker = nil }, onDone: { picked($0) })
                }
            }
            .overlay(alignment: .top) { ShareNotice(notice: $notice) }
    }

    private func send(_ id: String) {
        picker = sharing?.picker(id)
        postId = nil
    }

    private func copy(_ id: String) {
        copyLink(postLink(id))
        notice = localized("post_link_copied")
        postId = nil
    }

    private func picked(_ count: Int) {
        picker = nil
        notice = plural("forward_done", count)
    }
}

/// The conversation picker for a post, closed once the post went into every conversation picked.
private struct SharePick: View {
    let model: PickModel
    let onClose: () -> Void
    let onDone: (Int) -> Void

    var body: some View {
        PickView(model: model, title: "post_share_to_conversation", onClose: onClose)
            .onChange(of: model.done) { _, done in
                if let done { onDone(done) }
            }
    }
}

/// The short notice after a share, read aloud and gone after a moment.
private struct ShareNotice: View {
    @Binding var notice: String?

    var body: some View {
        if let notice {
            Text(verbatim: notice)
                .font(.sans(13, black: true))
                .foregroundStyle(BrandTokens.Colors.fg)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(BrandTokens.Colors.surface, in: Capsule())
                .overlay { Capsule().strokeBorder(BrandTokens.Colors.border) }
                .padding(.top, 8)
                .transition(.opacity)
                .accessibilityAddTraits(.updatesFrequently)
                .task(id: notice) {
                    AccessibilityNotification.Announcement(notice).post()
                    try? await Task.sleep(for: .seconds(2.5))
                    if !Task.isCancelled { self.notice = nil }
                }
        }
    }
}

private struct ShareOptions: View {
    let canSend: Bool
    let onSend: @MainActor () -> Void
    let onCopy: @MainActor () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("share")
                .font(.sans(17, black: true))
                .padding(.bottom, 8)
            if canSend {
                row("bubble.left.and.bubble.right", "post_share_to_conversation", onSend)
            }
            row("link", "post_copy_link", onCopy)
            Spacer(minLength: 0)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func row(
        _ systemImage: String, _ key: LocalizedStringKey, _ action: @escaping @MainActor () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 28)
                    .accessibilityHidden(true)
                Text(key).font(.sans(15, black: true))
                Spacer()
            }
            .foregroundStyle(BrandTokens.Colors.fg)
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
