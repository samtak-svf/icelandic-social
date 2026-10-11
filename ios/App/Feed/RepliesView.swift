import SpjallCore
import SwiftUI

/// A post and its replies, oldest first, with a line to reply at the bottom
/// (decision 0034). A post deleted meanwhile sends the screen back.
struct RepliesView: View {
    let model: RepliesModel
    let onAuthor: (Person) -> Void

    @State private var deleting: Reply?
    @Environment(\.postSharing) private var sharing
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            BackBar(title: localized("replies_title"))
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if let post = model.post {
                        PostRow(
                            post: post,
                            onAuthor: { onAuthor(post.author) },
                            onHeart: { Task { await model.toggleHeart() } },
                            onShare: sharing.map { sharing in { sharing.open(post.postId) } })
                        Hairline()
                    }
                    if model.loaded && model.replies.isEmpty && model.post != nil {
                        EmptyState(systemImage: "bubble.left", text: "replies_empty")
                    }
                    ForEach(model.replies, id: \.replyId) { reply in
                        ReplyRow(reply: reply) { onAuthor(reply.author) }
                            .contextMenu {
                                if reply.author.account == model.me {
                                    Button("delete", role: .destructive) { deleting = reply }
                                }
                            }
                            .onAppear {
                                if reply.replyId == model.replies.last?.replyId { Task { await model.loadMore() } }
                            }
                    }
                    if model.loadingMore {
                        ProgressView().padding(16).frame(maxWidth: .infinity)
                    }
                }
            }
            .refreshable { await model.load() }
            if model.post != nil { ReplyBar(model: model) }
        }
        .background(BrandTokens.Colors.surface)
        .toolbar(.hidden, for: .navigationBar)
        .background { SwipeBack().frame(width: 0, height: 0) }
        .task {
            if !model.loaded { await model.load() }
        }
        .onChange(of: model.gone) { _, gone in
            if gone { dismiss() }
        }
        .confirmationDialog(
            "reply_delete_confirm",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible,
            presenting: deleting
        ) { reply in
            Button("delete", role: .destructive) { Task { await model.delete(reply.replyId) } }
            Button("cancel", role: .cancel) {}
        }
    }
}

/// One reply: a small circle, the byline and the text, indented under the post.
private struct ReplyRow: View {
    let reply: Reply
    let onAuthor: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Button(action: onAuthor) {
                Avatar(person: reply.author, size: 32)
            }
            .buttonStyle(.plain)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Byline(person: reply.author, at: reply.createdAt, onAuthor: onAuthor)
                Text(verbatim: reply.body)
                    .font(.sans(14.5))
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
        }
        .padding(.leading, 28)
        .padding(.trailing, 16)
        .padding(.vertical, 10)
    }
}

/// The line to reply on, and send.
private struct ReplyBar: View {
    let model: RepliesModel

    @State private var text = ""
    @FocusState private var focused: Bool

    private var blank: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(alignment: .bottom, spacing: 0) {
                TextField("reply_placeholder", text: $text, axis: .vertical)
                    .font(.sans(14))
                    .lineLimit(1...5)
                    .focused($focused)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .frame(minHeight: 40)
                    .background(
                        focused ? BrandTokens.Colors.surface : BrandTokens.Colors.muted,
                        in: RoundedRectangle(cornerRadius: 20)
                    )
                    .overlay {
                        if focused {
                            RoundedRectangle(cornerRadius: 20).strokeBorder(BrandTokens.Colors.fg, lineWidth: 1.5)
                        }
                    }
                    .padding(.vertical, 2)
                    .padding(.leading, 12)
                    .onChange(of: text) { _, new in
                        if new.count > PostsModel.maxLength { text = String(new.prefix(PostsModel.maxLength)) }
                    }
                RoundButton(
                    systemImage: "paperplane.fill", label: "send",
                    fill: blank ? BrandTokens.Colors.muted : BrandTokens.Colors.primary,
                    tint: blank ? BrandTokens.Colors.mutedFg : BrandTokens.Colors.primaryFg,
                    size: 40, enabled: !blank && !model.busy
                ) {
                    Task {
                        if await model.send(body: text) { text = "" }
                    }
                }
            }
            .padding(.trailing, 4)
            .padding(.vertical, 6)
        }
        .background(BrandTokens.Colors.surface)
    }
}
