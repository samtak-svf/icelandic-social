import SpjallCore
import SwiftUI

// The pieces the hosted screens share (decisions 0060, 0063). They are drawn on the cream, each post and
// comment a white card with its author's name over it, never as a conversation's bubbles: a screen always
// shows which kind of content it is.

/// A reported or reportable thing, as the report sheet opens on it.
struct Reporting: Identifiable {
    let target: ReportTarget
    var id: String { "\(target.kind)/\(target.id)" }
}

/// Who wrote it, with the verified mark, and when.
struct Byline: View {
    let author: Author?
    let createdAt: UInt64

    var body: some View {
        HStack(spacing: 10) {
            Avatar(name: author?.name, kind: author?.verified == true ? .verified : .unverified, size: 34)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(verbatim: authorName(author))
                        .font(.sans(14, black: true))
                        .foregroundStyle(BrandTokens.Colors.fg)
                        .lineLimit(1)
                    if author?.verified == true { VerifiedMark(size: 12) }
                }
                Text(verbatim: postedAt(createdAt))
                    .font(TypeStyle.meta)
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
            }
            Spacer(minLength: 8)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The mark on what a moderator hid or removed, which only moderators still see; nothing on what is shown.
struct StateMark: View {
    let state: ModerationState

    var body: some View {
        switch state {
        case .visible: EmptyView()
        case .hidden: mark("content_hidden")
        case .removed: mark("content_removed")
        }
    }

    private func mark(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(.sans(12.5, black: true))
            .foregroundStyle(BrandTokens.Colors.danger)
    }
}

/// The five reactions; this account's is pressed, and pressing it again takes it back. Read-only for whoever
/// may not write here.
struct ReactionBar: View {
    let post: Post
    let enabled: Bool
    let onReact: (ReactionKind) -> Void

    var body: some View {
        // Side by side, wrapping under a large font.
        ViewThatFits {
            HStack(spacing: 6) { buttons }
            VStack(alignment: .leading, spacing: 6) { buttons }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("reactions_title"))
    }

    @ViewBuilder private var buttons: some View {
        ForEach(reactionKinds, id: \.self) { kind in
            let mine = post.myReaction == kind
            let count = reactionCount(post, kind)
            Button {
                onReact(kind)
            } label: {
                HStack(spacing: 4) {
                    Text(verbatim: reactionEmoji(kind)).accessibilityHidden(true)
                    if count > 0 {
                        Text(verbatim: "\(count)").font(.sans(12.5, black: true))
                    }
                }
                .foregroundStyle(BrandTokens.Colors.fg)
                .padding(.horizontal, 10)
                .frame(minWidth: 44, minHeight: 36)
                .background(mine ? BrandTokens.Colors.primarySubtle : BrandTokens.Colors.surface, in: Capsule())
                .overlay {
                    Capsule().strokeBorder(mine ? BrandTokens.Colors.primary : BrandTokens.Colors.border, lineWidth: 1)
                }
                .frame(minHeight: 44)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(!enabled)
            .accessibilityLabel(Text(verbatim: count > 0 ? "\(reactionLabel(kind)), \(count)" : reactionLabel(kind)))
            .accessibilityAddTraits(mine ? [.isButton, .isSelected] : .isButton)
        }
    }
}

/// A post as a community's list and its own screen show it: who wrote it and when, its text and images, its
/// reactions, and its comment count, which opens it when `linked`, and a report; this account's own also has
/// a delete, `onDelete`, which asks first.
struct PostCard: View {
    let post: Post
    let linked: Bool
    let writes: Bool
    let onReact: (ReactionKind) -> Void
    let onReport: () -> Void
    var onDelete: (() -> Void)?

    var body: some View {
        Panel {
            VStack(alignment: .leading, spacing: 10) {
                StateMark(state: post.state)
                Byline(author: post.author, createdAt: post.createdAt)
                if !post.body.isEmpty {
                    Text(verbatim: post.body)
                        .font(TypeStyle.bubble)
                        .foregroundStyle(BrandTokens.Colors.fg)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
                PostImageGrid(post: post)
                ReactionBar(post: post, enabled: writes, onReact: onReact)
                HStack {
                    let comments = Text(verbatim: plural("post_comments", Int(post.commentCount)))
                        .font(.sans(13, black: true))
                    if linked {
                        NavigationLink(value: SocialRoute.post(post.postId)) {
                            comments.foregroundStyle(BrandTokens.Colors.primary)
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    } else {
                        comments.foregroundStyle(BrandTokens.Colors.mutedFg)
                    }
                    Spacer(minLength: 8)
                    if let onDelete { DeleteButton(action: onDelete) }
                    ReportButton(action: onReport)
                }
            }
            .padding(14)
        }
    }
}

/// A comment, oldest first under its post; this account's own has a delete, `onDelete`, which asks first.
struct CommentCard: View {
    let comment: Comment
    let onReport: () -> Void
    var onDelete: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            StateMark(state: comment.state)
            HStack(alignment: .top) {
                Byline(author: comment.author, createdAt: comment.createdAt)
                if let onDelete { DeleteButton(action: onDelete) }
                ReportButton(action: onReport)
            }
            Text(verbatim: comment.body)
                .font(TypeStyle.bubble)
                .foregroundStyle(BrandTokens.Colors.fg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
        .padding(14)
    }
}

/// The small flag that opens the report sheet.
struct ReportButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "flag")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(BrandTokens.Colors.mutedFg)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("report"))
    }
}

/// The small bin on this account's own post or comment, which asks before it deletes.
struct DeleteButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "trash")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(BrandTokens.Colors.danger)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("delete"))
    }
}

/// A box to write a post or a comment in, and its send button, at the foot of the screen; `above` goes over
/// the box (a post's picked images) and `leading` before it (the button that adds them).
struct SocialComposer<Above: View, Leading: View>: View {
    let placeholder: LocalizedStringKey
    let send: LocalizedStringKey
    @Binding var draft: String
    let limit: Int
    let enabled: Bool
    let onSend: () -> Void
    let above: Above
    let leading: Leading

    @FocusState private var focused: Bool

    init(
        placeholder: LocalizedStringKey, send: LocalizedStringKey, draft: Binding<String>, limit: Int, enabled: Bool,
        onSend: @escaping () -> Void, @ViewBuilder above: () -> Above, @ViewBuilder leading: () -> Leading
    ) {
        self.placeholder = placeholder
        self.send = send
        _draft = draft
        self.limit = limit
        self.enabled = enabled
        self.onSend = onSend
        self.above = above()
        self.leading = leading()
    }

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            above
            HStack(alignment: .bottom, spacing: 8) {
                leading
                TextField(placeholder, text: $draft, axis: .vertical)
                    .font(.sans(14))
                    .lineLimit(1...6)
                    .focused($focused)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .frame(minHeight: 40)
                    .background(
                        focused ? BrandTokens.Colors.surface : BrandTokens.Colors.muted,
                        in: RoundedRectangle(cornerRadius: 20)
                    )
                    .overlay {
                        RoundedRectangle(cornerRadius: 20)
                            .strokeBorder(focused ? BrandTokens.Colors.borderStrong : BrandTokens.Colors.border)
                    }
                    .onChange(of: draft) { _, text in
                        if text.count > limit { draft = String(text.prefix(limit)) }
                    }
                RoundButton(
                    systemImage: "arrow.up", label: send, fill: BrandTokens.Colors.primary,
                    tint: BrandTokens.Colors.primaryFg, size: 36, enabled: enabled, action: onSend)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(BrandTokens.Colors.surface)
    }
}

extension SocialComposer where Above == EmptyView, Leading == EmptyView {
    /// A box of text alone, as a comment's.
    init(
        placeholder: LocalizedStringKey, send: LocalizedStringKey, draft: Binding<String>, limit: Int, enabled: Bool,
        onSend: @escaping () -> Void
    ) {
        self.init(
            placeholder: placeholder, send: send, draft: draft, limit: limit, enabled: enabled, onSend: onSend,
            above: { EmptyView() }, leading: { EmptyView() })
    }
}

/// A line of text on its own in a hosted screen: why there is no composer, or that a request is waiting.
struct SocialNote: View {
    let text: LocalizedStringKey

    var body: some View {
        Text(text)
            .font(.sans(13.5))
            .foregroundStyle(BrandTokens.Colors.mutedFg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: 14))
    }
}

/// The report sheet: a reason, a note if the person wants, and send; then the thank-you.
struct ReportSheet: View {
    @State private var model: ReportModel
    @Environment(\.dismiss) private var dismiss

    init(social: Social, target: ReportTarget) {
        _model = State(initialValue: ReportModel(social: social, target: target))
    }

    var body: some View {
        NavigationStack {
            Form {
                if model.sent {
                    Text("report_sent").font(.sans(15))
                } else {
                    Section {
                        ForEach(reportReasons, id: \.self) { reason in
                            Button {
                                model.reason = reason
                            } label: {
                                HStack {
                                    Text(verbatim: reasonLabel(reason)).foregroundStyle(BrandTokens.Colors.fg)
                                    Spacer()
                                    if model.reason == reason {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(BrandTokens.Colors.primary)
                                            .accessibilityHidden(true)
                                    }
                                }
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(model.reason == reason ? [.isButton, .isSelected] : .isButton)
                        }
                    } header: {
                        Text("report_reason")
                    }
                    Section {
                        TextField(
                            "report_note", text: Binding(get: { model.note }, set: { model.note = $0 }),
                            axis: .vertical
                        )
                        .lineLimit(2...6)
                        .onChange(of: model.note) { _, text in
                            if text.count > ReportModel.noteLimit {
                                model.note = String(text.prefix(ReportModel.noteLimit))
                            }
                        }
                    }
                    if let problem = model.problem {
                        Section {
                            ProblemCard(problem: problem) { Task { await model.send() } }
                        }
                    }
                    Section {
                        Button {
                            Task { await model.send() }
                        } label: {
                            Text("report_send").frame(maxWidth: .infinity)
                        }
                        .disabled(!model.sendable || model.busy)
                    }
                }
            }
            .navigationTitle(Text("report_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Text(model.sent ? LocalizedStringKey("back") : LocalizedStringKey("cancel"))
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
