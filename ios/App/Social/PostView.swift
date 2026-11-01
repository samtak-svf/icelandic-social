import PhotosUI
import SpjallCore
import SwiftUI

/// One post (decisions 0063, 0071): its reactions, and its comments oldest first, one level of replies under the
/// comment each answers. The composer is pinned to the bottom bar, so it stays over the keyboard while the thread
/// scrolls behind it; a member of its community who is not muted writes there. This account's own post and
/// comments have a delete, which asks first.
struct PostView: View {
    let model: PostModel
    let social: Social

    @State private var reporting: Reporting?
    @State private var deletingPost = false
    @State private var sharing: String?
    /// The own comment waiting for the delete to be confirmed.
    @State private var deletingComment: String?
    @State private var removingComment: String?
    @State private var removalReason = ""
    @Environment(\.dismiss) private var dismiss
    @Environment(\.suspension) private var suspension

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if let post = model.post {
                    PostCard(
                        post: post, linked: false, writes: model.writes,
                        onReact: { emoji in Task { await model.react(emoji) } },
                        onReport: { reporting = Reporting(target: ReportTarget(kind: .post, id: post.postId)) },
                        onDelete: post.mine ? { deletingPost = true } : nil,
                        onPin: model.moderates ? { Task<Void, Never> { await model.pin(!post.pinned) } } : nil,
                        onShare: { sharing = post.postId },
                        onVote: { option in Task { await model.vote(option) } },
                        onWithdrawVote: { Task { await model.withdrawVote() } },
                        onClosePoll: model.canClosePoll ? { Task { await model.closePoll() } } : nil)
                    if model.ownsWall, let audience = post.audience {
                        Picker(
                            "wall_audience_label",
                            selection: Binding(get: { audience }, set: { new in Task { await model.setAudience(new) } })
                        ) {
                            Text("wall_audience_friends").tag(WallAudience.friends)
                            Text("wall_audience_everyone").tag(WallAudience.everyone)
                        }
                        .pickerStyle(.segmented)
                        .disabled(!mayWrite(suspension) || model.busy)
                    }
                    if let notice = model.noPostNotice {
                        SocialNote(text: LocalizedStringKey(notice))
                    }
                    if !isPostTombstone(post) { comments }
                } else if !model.loaded {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(16)
        }
        .background(BrandTokens.Colors.bg)
        .navigationTitle(Text(verbatim: model.community?.name ?? ""))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .bellInNavigationBar()
        .safeAreaInset(edge: .top) {
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
            }
        }
        .safeAreaInset(edge: .top) { SuspendedNotice() }
        .safeAreaInset(edge: .bottom) {
            if model.writes {
                VStack(spacing: 0) {
                    if let comment = model.replyingTo {
                        ReplyBar(name: authorName(comment.author)) { model.cancelReply() }
                    }
                    CommentComposer(
                        name: model.myName, photo: model.myPhoto,
                        draft: Binding(get: { model.draft }, set: { model.draft = $0 }),
                        limit: PostModel.commentLimit, enabled: model.sendable && !model.busy,
                        image: model.image, notice: model.imageNotice, busy: model.busy,
                        onPick: { item in Task { await model.pick(Picked(photo: item)) } },
                        onUnpick: { model.unpick() },
                        onSend: { Task { await model.publish() } })
                }
            }
        }
        .alert("post_delete_confirm", isPresented: $deletingPost) {
            Button("delete", role: .destructive) { Task { await model.deletePost() } }
            Button("cancel", role: .cancel) {}
        }
        .alert(
            "comment_delete_confirm",
            isPresented: Binding(get: { deletingComment != nil }, set: { if !$0 { deletingComment = nil } }),
            presenting: deletingComment
        ) { commentId in
            Button("delete", role: .destructive) { Task { await model.deleteComment(commentId) } }
            Button("cancel", role: .cancel) {}
        }
        .alert(
            "wall_comment_remove_confirm",
            isPresented: Binding(get: { removingComment != nil }, set: { if !$0 { removingComment = nil } }),
            presenting: removingComment
        ) { commentId in
            TextField("wall_comment_remove_reason", text: $removalReason)
            Button("wall_comment_remove", role: .destructive) {
                let reason = removalReason
                removalReason = ""
                Task { await model.removeWallComment(commentId, reason: reason) }
            }
            Button("cancel", role: .cancel) { removalReason = "" }
        }
        .onChange(of: model.deleted) { _, deleted in
            if deleted { dismiss() }
        }
        .sharingPost($sharing)
        .sheet(item: $reporting) { reporting in
            ReportSheet(social: social, target: reporting.target)
        }
        .task { await model.load() }
    }

    /// The thread: each top-level comment with the replies to it under it, indented, and `Svara` on the ones that
    /// a reply may answer (decision 0071).
    @ViewBuilder private var comments: some View {
        if model.loaded && model.comments.isEmpty && model.next == nil && model.problem == nil {
            EmptyState(systemImage: "text.bubble", text: "comments_empty")
        }
        let threads = commentThreads(model.comments)
        ForEach(Array(threads.indices), id: \.self) { index in
            let thread = threads[index]
            card(thread.comment, replies: thread.replies.count, replyable: true)
            ForEach(thread.replies, id: \.commentId) { reply in
                card(reply, replies: 0, replyable: false)
                    .padding(.leading, Self.indent)
            }
        }
        if model.next != nil {
            Color.clear.frame(height: 1).task(id: model.next) { await model.more() }
        }
    }

    private func card(_ comment: Comment, replies: Int, replyable: Bool) -> some View {
        CommentCard(
            comment: comment,
            onReport: { reporting = Reporting(target: ReportTarget(kind: .comment, id: comment.commentId)) },
            onDelete: model.mine(comment.author)
                ? { deletingComment = comment.commentId }
                : (model.ownsWall ? { removingComment = comment.commentId } : nil),
            onReply: replyable ? { model.reply(to: comment) } : nil,
            onLike: mayWrite(suspension, model.writes)
                ? { Task<Void, Never> { await model.like(comment.commentId) } } : nil,
            replies: replies)
    }

    /// How far a reply stands in from the comment it answers.
    private static let indent: CGFloat = 28
}

/// The line over the composer while a reply is being written: whose comment it answers, and a way to stop.
private struct ReplyBar: View {
    let name: String
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Text(verbatim: localized("comment_replying_to", name))
                .font(.sans(12.5, black: true))
                .foregroundStyle(BrandTokens.Colors.primary)
                .lineLimit(1)
            Spacer(minLength: 8)
            Button(action: onCancel) {
                Text("cancel")
                    .font(.sans(12.5, black: true))
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                    .frame(minHeight: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .background(BrandTokens.Colors.primarySubtle)
    }
}

/// The comment box, one row pinned to the bottom: the reader's own picture, a field that grows to five lines, and
/// a send arrow that waits for something to send (decision 0080). The photo button takes one image (decision
/// 0082), shown above the row with an X until it is sent.
private struct CommentComposer: View {
    let name: String?
    let photo: PhotoOf?
    @Binding var draft: String
    let limit: Int
    let enabled: Bool
    /// The picked image's local copy, if there is one, and why the last one was not taken.
    let image: String?
    let notice: CommunityModel.ImageNotice?
    let busy: Bool
    let onPick: (PhotosPickerItem) -> Void
    let onUnpick: () -> Void
    let onSend: () -> Void

    @FocusState private var focused: Bool
    @Environment(\.suspension) private var suspension
    @State private var picking = false
    @State private var selection: PhotosPickerItem?

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            if let image {
                PickedImages(paths: [image]) { _ in onUnpick() }
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let notice {
                SocialNote(text: noticeText(notice))
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(alignment: .bottom, spacing: 8) {
                Avatar(name: name, kind: .me, size: 34, photo: photo)
                    .padding(.bottom, 3)
                RoundButton(
                    systemImage: "photo", label: "comment_add_image", fill: BrandTokens.Colors.muted,
                    tint: BrandTokens.Colors.fg, size: 40, enabled: mayWrite(suspension, !busy && image == nil)
                ) { picking = true }
                TextField("post_write_comment", text: $draft, axis: .vertical)
                    .font(.sans(14))
                    .lineLimit(1...5)
                    .focused($focused)
                    .disabled(!mayWrite(suspension))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .frame(minHeight: 40)
                    .background(
                        focused ? BrandTokens.Colors.surface : BrandTokens.Colors.muted,
                        in: RoundedRectangle(cornerRadius: BrandTokens.Radius.field)
                    )
                    .overlay {
                        RoundedRectangle(cornerRadius: BrandTokens.Radius.field)
                            .strokeBorder(focused ? BrandTokens.Colors.borderStrong : BrandTokens.Colors.border)
                    }
                    .onChange(of: draft) { _, text in
                        if textLength(text) > limit { draft = clippedText(text, to: limit) }
                    }
                Button(action: onSend) {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(enabled ? BrandTokens.Colors.primary : BrandTokens.Colors.mutedFg)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!mayWrite(suspension, enabled))
                .accessibilityLabel(Text("comment_publish"))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
        .background(BrandTokens.Colors.surface)
        .photosPicker(isPresented: $picking, selection: $selection, matching: .images)
        .onChange(of: selection) { _, item in
            guard let item else { return }
            selection = nil
            onPick(item)
        }
    }

    private func noticeText(_ notice: CommunityModel.ImageNotice) -> LocalizedStringKey {
        switch notice {
        case .tooMany, .invalid: "post_image_failed"
        case .tooLarge: "post_image_too_large"
        }
    }
}
