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
    /// The own comment waiting for the delete to be confirmed.
    @State private var deletingComment: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if let post = model.post {
                    PostCard(
                        post: post, linked: false, writes: model.writes,
                        onReact: { kind in Task { await model.react(kind) } },
                        onReport: { reporting = Reporting(target: ReportTarget(kind: .post, id: post.postId)) },
                        onDelete: model.mine(post.author) ? { deletingPost = true } : nil,
                        onPin: model.moderates ? { Task { await model.pin(!post.pinned) } } : nil)
                    if model.muted {
                        SocialNote(text: "community_muted")
                    }
                    comments
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
        .safeAreaInset(edge: .top) {
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if model.writes {
                VStack(spacing: 0) {
                    if let comment = model.replyingTo {
                        ReplyBar(name: authorName(comment.author)) { model.cancelReply() }
                    }
                    SocialComposer(
                        placeholder: "comment_compose", send: "comment_publish",
                        draft: Binding(get: { model.draft }, set: { model.draft = $0 }),
                        limit: PostModel.commentLimit, enabled: model.sendable && !model.busy,
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
        .onChange(of: model.deleted) { _, deleted in
            if deleted { dismiss() }
        }
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
            onDelete: model.mine(comment.author) ? { deletingComment = comment.commentId } : nil,
            onReply: replyable ? { model.reply(to: comment) } : nil,
            onLike: model.writes ? { Task { await model.like(comment.commentId) } } : nil,
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
