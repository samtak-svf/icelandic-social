import PhotosUI
import SpjallCore
import SwiftUI

// The pieces the hosted screens share (decisions 0060, 0063, 0079). They are drawn on the cream, each post and
// comment a white card with its author's name over it, never as a conversation's bubbles: a screen always
// shows which kind of content it is.

/// A reported or reportable thing, as the report sheet opens on it.
struct Reporting: Identifiable {
    let target: ReportTarget
    var id: String { "\(target.kind)/\(target.id)" }
}

/// A community's badge: a rounded square with its initials, or its audience where a name has no initials to show
/// (decision 0079). The row's text says which community it is, so this says nothing.
struct CommunityBadge: View {
    let community: Community
    var size: CGFloat = 40

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28)
            .fill(BrandTokens.Colors.secondarySubtle)
            .frame(width: size, height: size)
            .overlay { letters }
            .accessibilityHidden(true)
    }

    @ViewBuilder private var letters: some View {
        if community.name.trimmingCharacters(in: .whitespaces).isEmpty {
            Image(systemName: community.audience == .open ? "person.3" : "person.3.fill")
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(BrandTokens.Colors.fg)
        } else {
            Text(verbatim: initials(community.name))
                .font(.sansFixed(size * 0.38, black: true))
                .foregroundStyle(BrandTokens.Colors.fg)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
    }
}

/// How many things wait on a row, as `Stjórna` counts them (decision 0079).
struct CountBadge: View {
    let count: Int

    var body: some View {
        Text(verbatim: "\(count)")
            .font(.sans(12, black: true))
            .foregroundStyle(BrandTokens.Colors.primaryFg)
            .padding(.horizontal, 8)
            .frame(minWidth: 22, minHeight: 22)
            .background(BrandTokens.Colors.primary, in: Capsule())
    }
}

/// The field a list is searched with, as the hub finds a community and a community finds a post (decision 0079).
struct SocialSearchField: View {
    let prompt: LocalizedStringKey
    @Binding var text: String
    /// The longest the server takes, when it has a limit of its own.
    var limit: Int?

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(BrandTokens.Colors.mutedFg)
                .accessibilityHidden(true)
            TextField(text: $text, prompt: Text(prompt)) {
                Text(prompt)
            }
            .autocorrectionDisabled()
            .submitLabel(.search)
            .onChange(of: text) { _, typed in
                if let limit, typed.count > limit { text = String(typed.prefix(limit)) }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(BrandTokens.Colors.surface, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(BrandTokens.Colors.border))
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}

/// The way into a community's tools, its label carrying the work that waits for this account (decision 0079):
/// `Stjórna`, or `Stjórna (2)` while something does.
struct ManageButton: View {
    let count: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(
                verbatim: count > 0
                    ? localized("community_manage_count", count) : localized("community_manage")
            )
            .font(.sans(12.5, black: true))
            .foregroundStyle(BrandTokens.Colors.primary)
            .padding(.horizontal, 12)
            .frame(minHeight: 34)
            .overlay { Capsule().strokeBorder(BrandTokens.Colors.primary, lineWidth: 1) }
            .contentShape(Capsule())
            .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
    }
}

/// A community's name and description, the fields the screen that makes a community and the one that changes it
/// both show (decisions 0063, 0079).
struct CommunityTextFields: View {
    @Binding var name: String
    @Binding var description: String

    var body: some View {
        TextField("community_name", text: $name)
            .onChange(of: name) { _, typed in
                if typed.count > communityNameLimit { name = String(typed.prefix(communityNameLimit)) }
            }
        TextField("community_description", text: $description, axis: .vertical)
            .lineLimit(2...6)
            .onChange(of: description) { _, typed in
                if typed.count > communityDescriptionLimit {
                    description = String(typed.prefix(communityDescriptionLimit))
                }
            }
    }
}

/// A community's picture and cover (decision 0080): choose or replace each, and take each away. The form that
/// makes a community keeps the picks until it is made; the one that changes it sends them at once. The picks
/// are cut small off the main thread by the caller.
struct CommunityPictureFields: View {
    let hasPicture: Bool
    let hasCover: Bool
    let onPicture: (Picked) -> Void
    let onCover: (Picked) -> Void
    let onRemovePicture: () -> Void
    let onRemoveCover: () -> Void
    var disabled = false

    @State private var picture: PhotosPickerItem?
    @State private var cover: PhotosPickerItem?

    var body: some View {
        fields.disabled(disabled)
    }

    @ViewBuilder private var fields: some View {
        PhotosPicker(selection: $picture, matching: .images) {
            Label {
                Text("community_picture_choose")
            } icon: {
                Image(systemName: hasPicture ? "checkmark.circle.fill" : "photo")
            }
        }
        .onChange(of: picture) { _, item in
            guard let item else { return }
            picture = nil
            onPicture(Picked(photo: item))
        }
        if hasPicture {
            Button(role: .destructive, action: onRemovePicture) {
                Text("community_picture_remove")
            }
        }
        PhotosPicker(selection: $cover, matching: .images) {
            Label {
                Text("community_cover_choose")
            } icon: {
                Image(systemName: hasCover ? "checkmark.circle.fill" : "photo.on.rectangle")
            }
        }
        .onChange(of: cover) { _, item in
            guard let item else { return }
            cover = nil
            onCover(Picked(photo: item))
        }
        if hasCover {
            Button(role: .destructive, action: onRemoveCover) {
                Text("community_cover_remove")
            }
        }
    }
}

/// A community's audience, as the two rows both forms offer with what each means (decisions 0063, 0079). A private
/// community never becomes open again, so `locked` offers the private audience alone.
struct CommunityAudiencePicker: View {
    @Binding var audience: CommunityAudience
    /// The community is private already, which it stays (decision 0063).
    var locked = false

    var body: some View {
        if !locked {
            row(.open, label: "community_open", hint: "community_open_hint")
        }
        row(.private, label: "community_private", hint: "community_private_hint")
    }

    private func row(_ value: CommunityAudience, label: LocalizedStringKey, hint: LocalizedStringKey)
        -> some View
    {
        Button {
            audience = value
        } label: {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(label).font(.sans(14.5, black: true)).foregroundStyle(BrandTokens.Colors.fg)
                    Text(hint).font(.sans(13)).foregroundStyle(BrandTokens.Colors.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Image(systemName: audience == value ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(audience == value ? BrandTokens.Colors.primary : BrandTokens.Colors.mutedFg)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(audience == value ? [.isButton, .isSelected] : .isButton)
    }
}

/// Who wrote it, with the verified mark, and when; `community` names the community a post from the hub's feed is
/// in, and `menu` is what the card offers at the end of the row.
struct Byline<Menu: View>: View {
    let author: Author?
    let createdAt: UInt64
    var community: String?
    let menu: Menu

    init(author: Author?, createdAt: UInt64, community: String? = nil, @ViewBuilder menu: () -> Menu) {
        self.author = author
        self.createdAt = createdAt
        self.community = community
        self.menu = menu()
    }

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
                if let community {
                    HStack(spacing: 4) {
                        Image(systemName: "person.3.fill")
                            .font(.system(size: 9, weight: .semibold))
                            .accessibilityHidden(true)
                        Text(verbatim: community)
                            .lineLimit(1)
                    }
                    .font(TypeStyle.meta)
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                }
            }
            Spacer(minLength: 8)
            menu
        }
    }
}

extension Byline where Menu == EmptyView {
    /// A byline with nothing to offer at its end.
    init(author: Author?, createdAt: UInt64, community: String? = nil) {
        self.init(author: author, createdAt: createdAt, community: community) { EmptyView() }
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

/// A post as a community's list, the hub's feed and its own screen show it: who wrote it and when, its community
/// when the screen is not that community's, its text and images, its reactions, and its comment count, which opens
/// it. A tap on the text or the images opens it too when `linked`, and reporting and deleting it are in the
/// byline's menu (decision 0079).
struct PostCard: View {
    let post: Post
    let linked: Bool
    let writes: Bool
    /// The community's name, when the card is shown outside it, as the hub's feed shows it.
    var community: String?
    let onReact: (ReactionKind) -> Void
    /// The report sheet, where the screen showing the card has one.
    var onReport: (() -> Void)?
    var onDelete: (() -> Void)?

    var body: some View {
        Panel {
            VStack(alignment: .leading, spacing: 10) {
                StateMark(state: post.state)
                Byline(author: post.author, createdAt: post.createdAt, community: community) {
                    PostMenu(onReport: onReport, onDelete: onDelete)
                }
                wayIn
                ReactionBar(post: post, enabled: writes, onReact: onReact)
                footer
            }
            .padding(14)
        }
    }

    /// What a tap opens: the post's own screen, of which its text and images are the way in.
    @ViewBuilder private var wayIn: some View {
        if linked {
            NavigationLink(value: SocialRoute.post(post.postId)) {
                written
            }
            .buttonStyle(.plain)
        } else {
            written
        }
    }

    @ViewBuilder private var written: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !post.body.isEmpty {
                Text(verbatim: post.body)
                    .font(TypeStyle.bubble)
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            PostImageGrid(post: post)
        }
    }

    private var footer: some View {
        HStack(spacing: 8) {
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
        }
    }
}

/// What a post card offers at the end of its byline: reporting it, and deleting it when it is this account's own;
/// nothing when the screen has no sheet for either (decision 0079).
private struct PostMenu: View {
    let onReport: (() -> Void)?
    let onDelete: (() -> Void)?

    var body: some View {
        if onReport != nil || onDelete != nil {
            Menu {
                if let onReport {
                    Button(action: onReport) {
                        Label("report", systemImage: "flag")
                    }
                }
                if let onDelete {
                    Button(role: .destructive, action: onDelete) {
                        Label("delete", systemImage: "trash")
                    }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel(Text("more_options"))
        }
    }
}

/// A comment, oldest first under its post, with the replies to it indented beneath it (decision 0071). This
/// account's own has a delete, `onDelete`, which asks first; a top-level comment says `Svara`, and how many
/// replies it has. A comment a moderator removed stands in as `comment_tombstone` while its replies are shown.
struct CommentCard: View {
    let comment: Comment
    let onReport: () -> Void
    var onDelete: (() -> Void)?
    /// Writes a reply to this comment; nil on a reply, since one level is all a thread takes.
    var onReply: (() -> Void)?
    /// How many replies this comment has.
    var replies = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if isTombstone(comment) {
                Text("comment_tombstone")
                    .font(.sans(13.5))
                    .italic()
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
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
                HStack(spacing: 10) {
                    if let onReply {
                        Button(action: onReply) {
                            Text("comment_reply")
                                .font(.sans(12.5, black: true))
                                .foregroundStyle(BrandTokens.Colors.primary)
                                .frame(minHeight: 36)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(.isButton)
                    }
                    if replies > 0 {
                        Text(verbatim: plural("comment_replies_count", replies))
                            .font(TypeStyle.meta)
                            .foregroundStyle(BrandTokens.Colors.mutedFg)
                    }
                }
            }
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
/// the box (a post's picked images) and `leading` before it (the button that adds them). One that opens because
/// it was asked for takes the keyboard at once, as the sheet of a feed's one-line prompt does (decision 0079).
struct SocialComposer<Above: View, Leading: View>: View {
    let placeholder: LocalizedStringKey
    let send: LocalizedStringKey
    @Binding var draft: String
    let limit: Int
    let enabled: Bool
    let onSend: () -> Void
    let above: Above
    let leading: Leading
    var beginsFocused = false

    @FocusState private var focused: Bool

    init(
        placeholder: LocalizedStringKey, send: LocalizedStringKey, draft: Binding<String>, limit: Int, enabled: Bool,
        onSend: @escaping () -> Void, beginsFocused: Bool = false, @ViewBuilder above: () -> Above,
        @ViewBuilder leading: () -> Leading
    ) {
        self.placeholder = placeholder
        self.send = send
        _draft = draft
        self.limit = limit
        self.enabled = enabled
        self.onSend = onSend
        self.beginsFocused = beginsFocused
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
        .onAppear {
            if beginsFocused { focused = true }
        }
    }
}

extension SocialComposer where Above == EmptyView, Leading == EmptyView {
    /// A box of text alone, as a comment's.
    init(
        placeholder: LocalizedStringKey, send: LocalizedStringKey, draft: Binding<String>, limit: Int, enabled: Bool,
        onSend: @escaping () -> Void, beginsFocused: Bool = false
    ) {
        self.init(
            placeholder: placeholder, send: send, draft: draft, limit: limit, enabled: enabled, onSend: onSend,
            beginsFocused: beginsFocused, above: { EmptyView() }, leading: { EmptyView() })
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
