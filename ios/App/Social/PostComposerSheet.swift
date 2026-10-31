import PhotosUI
import SwiftUI

/// The full composer of a post, opened by a prompt and closed again once the post is published or the reader
/// leaves it (decision 0079). A community's and a wall's share it: the words, up to four images or a poll
/// (`attachments`), and whatever else the post takes (`extra`: a community's anonymous toggle, a wall's audience).
struct PostComposerSheet<Extra: View>: View {
    @Binding var draft: String
    let attachments: PostAttachments
    let sendable: Bool
    let busy: Bool
    let problem: Problem?
    let retry: () async -> Void
    /// Publishes the post; true once it is posted.
    let publish: () async -> Bool
    @ViewBuilder let extra: Extra

    @Environment(\.dismiss) private var dismiss
    @State private var picking = false
    @State private var photos: [PhotosPickerItem] = []

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                if let problem {
                    ProblemCard(problem: problem) { Task { await retry() } }.padding(16)
                }
                SocialComposer(
                    placeholder: "post_compose", send: "post_publish", draft: $draft,
                    limit: CommunityModel.postLimit, enabled: sendable && !busy,
                    onSend: {
                        Task {
                            if await publish() { dismiss() }
                        }
                    },
                    beginsFocused: true,
                    above: { above },
                    leading: {
                        HStack(spacing: 6) {
                            RoundButton(
                                systemImage: "photo.badge.plus", label: "post_add_images",
                                fill: BrandTokens.Colors.muted, tint: BrandTokens.Colors.fg, size: 40,
                                enabled: !busy && !attachments.isPoll
                            ) {
                                if attachments.roomForImage() { picking = true }
                            }
                            RoundButton(
                                systemImage: "chart.bar", label: "composer_poll",
                                fill: attachments.isPoll ? BrandTokens.Colors.primary : BrandTokens.Colors.muted,
                                tint: attachments.isPoll ? BrandTokens.Colors.bg : BrandTokens.Colors.fg, size: 40,
                                enabled: !busy && (attachments.isPoll || attachments.images.isEmpty)
                            ) {
                                attachments.setPoll(!attachments.isPoll)
                            }
                        }
                    })
            }
            .background(BrandTokens.Colors.bg)
            .navigationTitle(Text("post_compose"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Text("cancel")
                    }
                }
            }
            .photosPicker(
                isPresented: $picking, selection: $photos, maxSelectionCount: max(1, attachments.imagesLeft),
                matching: .images
            )
            .onChange(of: photos) { _, picked in
                guard !picked.isEmpty else { return }
                photos = []
                Task {
                    for item in picked { await attachments.pick(Picked(photo: item)) }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// The poll, what the post also takes, the images picked, and why the last one was not taken.
    @ViewBuilder private var above: some View {
        if attachments.isPoll { PollFields(model: attachments) }
        extra
        if !attachments.images.isEmpty {
            PickedImages(paths: attachments.images) { path in attachments.unpick(path) }
        }
        if let notice = attachments.imageNotice {
            SocialNote(text: noticeText(notice))
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func noticeText(_ notice: CommunityModel.ImageNotice) -> LocalizedStringKey {
        switch notice {
        case .tooMany: "post_images_too_many"
        case .tooLarge: "post_image_too_large"
        case .invalid: "post_image_failed"
        }
    }
}
