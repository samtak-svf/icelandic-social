import SpjallCore
import SwiftUI

/// A model's posts with hairlines between, the next page fetched as the last
/// one comes into view, and `empty` when there are none.
struct PostList: View {
    let model: PostsModel
    let empty: LocalizedStringKey
    let onAuthor: (Person) -> Void
    let onReplies: (String) -> Void

    var body: some View {
        LazyVStack(spacing: 0) {
            if model.loaded && model.posts.isEmpty && model.problem == nil {
                Text(empty)
                    .font(.sans(14))
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                    .multilineTextAlignment(.center)
                    .padding(24)
                    .frame(maxWidth: .infinity)
            }
            ForEach(model.posts, id: \.postId) { post in
                PostRow(
                    post: post,
                    onAuthor: { onAuthor(post.author) },
                    onHeart: { Task { await model.toggleHeart(post) } },
                    onReplies: { onReplies(post.postId) },
                    onDelete: post.author.account == model.me ? { Task { await model.delete(post.postId) } } : nil
                )
                .onAppear {
                    if post.postId == model.posts.last?.postId { Task { await model.loadMore() } }
                }
                Hairline()
            }
            if model.loadingMore {
                ProgressView().padding(16)
            }
        }
    }
}

/// One post (Fljótið, a wall): who wrote it and when, the text, a heart and
/// the replies. Its author can delete it, after a question.
struct PostRow: View {
    let post: Post
    let onAuthor: () -> Void
    let onHeart: () -> Void
    /// Nil on the replies screen, which is where the button leads.
    var onReplies: (() -> Void)?
    /// Nil unless the post is this account's own.
    var onDelete: (() -> Void)?

    @State private var deleting = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button(action: onAuthor) {
                Avatar(name: post.author.name, kind: avatarKind(post.author), size: 40)
            }
            .buttonStyle(.plain)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Byline(person: post.author, at: post.createdAt, onAuthor: onAuthor)
                    Spacer(minLength: 0)
                    if onDelete != nil {
                        Menu {
                            Button("delete", role: .destructive) { deleting = true }
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(BrandTokens.Colors.mutedFg)
                                .frame(minWidth: 44, minHeight: 28)
                                .contentShape(Rectangle())
                        }
                        .accessibilityLabel(Text("more_options"))
                    }
                }
                Text(verbatim: post.body)
                    .font(.sans(15))
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                HStack(spacing: 18) {
                    let hearted = post.myReaction != nil
                    PostAction(
                        systemImage: hearted ? "heart.fill" : "heart", count: post.reactionTotal, label: "post_react",
                        tint: hearted ? BrandTokens.Colors.primary : BrandTokens.Colors.mutedFg, selected: hearted,
                        action: onHeart)
                    if let onReplies {
                        PostAction(
                            systemImage: "bubble.left", count: post.replyCount, label: "post_reply",
                            tint: BrandTokens.Colors.mutedFg, selected: false, action: onReplies)
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .confirmationDialog("post_delete_confirm", isPresented: $deleting, titleVisibility: .visible) {
            Button("delete", role: .destructive) { onDelete?() }
            Button("cancel", role: .cancel) {}
        }
    }
}

/// The author's name, their mark when Kenni vouched for it, and how long ago.
struct Byline: View {
    let person: Person
    let at: UInt64
    let onAuthor: () -> Void

    var body: some View {
        HStack(spacing: 5) {
            Button(action: onAuthor) {
                HStack(spacing: 5) {
                    Text(verbatim: shownName(person))
                        .font(.sans(14.5, black: true, relativeTo: .headline))
                        .foregroundStyle(BrandTokens.Colors.fg)
                        .lineLimit(1)
                    if person.verified { VerifiedMark(size: 14) }
                }
            }
            .buttonStyle(.plain)
            Text(verbatim: listStamp(at))
                .font(.sans(12, relativeTo: .caption))
                .foregroundStyle(BrandTokens.Colors.mutedFg)
                .lineLimit(1)
        }
    }
}

/// A post's heart or replies: an icon and, when there are any, how many.
private struct PostAction: View {
    let systemImage: String
    let count: UInt32
    let label: LocalizedStringKey
    let tint: Color
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: systemImage).font(.system(size: 15))
                if count > 0 {
                    Text(verbatim: "\(count)").font(.sans(12.5, black: true, relativeTo: .caption))
                }
            }
            .foregroundStyle(tint)
            .frame(minHeight: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(verbatim: count > 0 ? "\(count)" : ""))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

/// The white pill that opens the composer.
struct ComposerPill: View {
    let placeholder: LocalizedStringKey
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(placeholder)
                .font(.sans(14))
                .foregroundStyle(BrandTokens.Colors.mutedFg)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(.horizontal, 16)
                .background(BrandTokens.Colors.surface, in: Capsule())
                .overlay { Capsule().strokeBorder(BrandTokens.Colors.border, lineWidth: 1) }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

/// Writing a post, which everyone using the app can read.
struct ComposerSheet: View {
    let placeholder: LocalizedStringKey
    let onPost: @MainActor (String) async -> Bool

    @State private var text = ""
    @State private var sending = false
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss

    private var ready: Bool {
        !sending && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Button("cancel") { dismiss() }
                Spacer()
                Button {
                    send()
                } label: {
                    Text("post_action").font(.sans(14, black: true))
                }
                .buttonStyle(.borderedProminent)
                .disabled(!ready)
            }
            TextField(placeholder, text: $text, axis: .vertical)
                .font(.sans(15))
                .lineLimit(4...12)
                .focused($focused)
                .onChange(of: text) { _, new in
                    if new.count > PostsModel.maxLength { text = String(new.prefix(PostsModel.maxLength)) }
                }
            Text("feed_public_notice")
                .font(.sans(12, relativeTo: .footnote))
                .foregroundStyle(BrandTokens.Colors.mutedFg)
            Spacer(minLength: 0)
        }
        .padding(16)
        .presentationDetents([.medium, .large])
        .onAppear { focused = true }
    }

    private func send() {
        sending = true
        Task {
            if await onPost(text) { dismiss() }
            sending = false
        }
    }
}

/// The back arrow and, when there is one, the screen's title.
struct BackBar: View {
    var title: String?

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        HStack(spacing: 4) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("back"))
            if let title {
                Text(verbatim: title.capitals)
                    .font(TypeStyle.screenTitle)
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .lineLimit(1)
                    .accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, 4)
        .padding(.trailing, 16)
        .padding(.vertical, 4)
        .background(BrandTokens.Colors.bg.ignoresSafeArea(edges: .top))
    }
}
