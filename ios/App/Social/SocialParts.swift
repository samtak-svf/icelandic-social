import PhotosUI
import SpjallCore
import SwiftUI

// The pieces the hosted screens share (decisions 0060, 0063, 0079). They are drawn on the cream, each post and
// comment a card with its author's name over it, never as a conversation's bubbles: a screen always
// shows which kind of content it is.

/// A reported or reportable thing, as the report sheet opens on it.
struct Reporting: Identifiable {
    let target: ReportTarget
    var id: String { "\(target.kind)/\(target.id)" }
}

/// A community's badge: a rounded square with its picture (decision 0080), or its initials while that loads and
/// when there is none, or its audience where a name has no initials to show (decision 0079). The row's text says
/// which community it is, so this says nothing.
struct CommunityBadge: View {
    let community: Community
    var size: CGFloat = 40

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.28)
        LoadedPhoto(community.pictureOf) { image in
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(shape)
        } placeholder: {
            letters
        }
        .frame(width: size, height: size)
        .background(BrandTokens.Colors.secondarySubtle, in: shape)
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
        .background(BrandTokens.Colors.surface, in: RoundedRectangle(cornerRadius: Radii.thumbnail))
        .overlay(RoundedRectangle(cornerRadius: Radii.thumbnail).stroke(BrandTokens.Colors.border))
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

/// A post as a community's list, the hub's feed and its own screen show it, top to bottom as the groups readers know
/// lay it out (decision 0080): who wrote it with a badge and the age, a pin marker, the text cut at five lines with
/// `Sjá meira`, the images, a summary of the reactions, one row of `Líkar`, `Athugasemd` and `Deila`, the newest
/// comment and the pill that opens the post to write one. A tap on the text or the images opens the post when
/// `linked`, and everything else the card can do is in the byline's menu.
struct PostCard: View {
    let post: Post
    let linked: Bool
    let writes: Bool
    /// The community, when the card is shown outside it, as the hub's feed shows it: its name and picture.
    var community: Community?
    let onReact: (String) -> Void
    /// The report sheet, where the screen showing the card has one.
    var onReport: (() -> Void)?
    var onDelete: (() -> Void)?
    /// Pins the post, or takes the pin off: set for a moderator or the owner of its community, on a screen that can.
    var onPin: (() -> Void)?
    /// Opens `Deila`; the action is left out where a screen has none.
    var onShare: (() -> Void)?

    @Environment(\.suspension) private var suspension

    /// A suspension refuses every write the card offers (0115), whatever the screen allows.
    private var canWrite: Bool { mayWrite(suspension, writes) }
    /// Votes in the post's poll for the option, takes the vote back, or closes the poll (decision 0090). The close is
    /// set for the poll's author and for a moderator, while it is open.
    var onVote: ((String) -> Void)?
    var onWithdrawVote: (() -> Void)?
    var onClosePoll: (() -> Void)?
    /// Whether the sheet with every emoji is open.
    @State private var allEmoji = false

    var body: some View {
        if isPostTombstone(post) {
            PostTombstone(post: post, moderates: onPin != nil)
        } else {
            card
        }
    }

    private var card: some View {
        Panel {
            VStack(alignment: .leading, spacing: 10) {
                StateMark(state: post.state)
                if post.pinned { pinned }
                Byline(
                    author: post.author, anonymousName: anonymousByline(post), createdAt: post.createdAt,
                    community: community, audience: post.audience, short: true
                ) {
                    PostMenu(
                        pinned: post.pinned, onReport: onReport, onDelete: onDelete, onPin: onPin,
                        onClosePoll: onClosePoll)
                }
                wayIn
                if let poll = post.poll {
                    PollView(
                        poll: poll, question: post.body, canVote: canWrite && onVote != nil,
                        onVote: { onVote?($0) }, onWithdraw: { onWithdrawVote?() })
                }
                summary
                Hairline()
                actions
                if linked { discussion }
            }
            .padding(14)
        }
    }

    private var pinned: some View {
        HStack(spacing: 4) {
            Image(systemName: "pin.fill")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text("post_pinned")
        }
        .font(.sans(12, black: true))
        .foregroundStyle(BrandTokens.Colors.mutedFg)
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
                    .lineLimit(linked ? Self.bodyLines : nil)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                if linked && isLong {
                    Text("post_see_more")
                        .font(.sans(13, black: true))
                        .foregroundStyle(BrandTokens.Colors.primary)
                }
            }
            PostImageGrid(post: post)
        }
    }

    /// How many lines of the text a card in a list shows.
    private static let bodyLines = 5

    /// From which length a text is taken as one the clamp cuts; the same tie the community header uses.
    private static let longBody = 240

    private var isLong: Bool {
        post.body.count > Self.longBody || post.body.filter(\.isNewline).count >= Self.bodyLines
    }

    /// The reactions used, the most given first, and how many there are, beside the comment count, which opens the
    /// post. Nothing when there is neither.
    @ViewBuilder private var summary: some View {
        let total = post.emojis.reduce(UInt64(0)) { $0 + $1.count }
        if total > 0 || post.commentCount > 0 {
            HStack(spacing: 8) {
                if total > 0 {
                    HStack(spacing: 4) {
                        Text(verbatim: summaryEmojis(post))
                            .accessibilityHidden(true)
                        Text(verbatim: "\(total)")
                            .font(.sans(13))
                            .foregroundStyle(BrandTokens.Colors.mutedFg)
                    }
                    .accessibilityElement(children: .combine)
                }
                Spacer(minLength: 8)
                if post.commentCount > 0 {
                    let comments = Text(verbatim: plural("post_comments", Int(post.commentCount)))
                        .font(.sans(13))
                    if linked {
                        NavigationLink(value: SocialRoute.post(post.postId)) {
                            comments.foregroundStyle(BrandTokens.Colors.mutedFg)
                                .frame(minHeight: 32)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    } else {
                        comments.foregroundStyle(BrandTokens.Colors.mutedFg)
                    }
                }
            }
        }
    }

    /// `Líkar`, `Athugasemd` and `Deila` as three equal columns. `Líkar` gives 👍 on a tap, or takes back what
    /// this account gave; a long press offers the quick bar and a plus that opens every emoji.
    private var actions: some View {
        HStack(spacing: 0) {
            like
            if linked {
                NavigationLink(value: SocialRoute.post(post.postId)) {
                    ActionLabel(systemImage: "bubble.left", text: "post_comment_action", active: false)
                }
                .buttonStyle(.plain)
            }
            if let onShare, post.canBeSent {
                Button(action: onShare) {
                    ActionLabel(systemImage: "arrowshape.turn.up.right", text: "share", active: false)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var like: some View {
        Menu {
            ForEach(quickReactions, id: \.self) { reaction in
                Button {
                    onReact(reaction.emoji)
                } label: {
                    Text(verbatim: "\(reaction.emoji) \(localized(reaction.label))")
                }
            }
            Button {
                allEmoji = true
            } label: {
                Text("post_reactions_all")
            }
        } label: {
            ActionLabel(
                systemImage: post.myEmoji == nil ? "hand.thumbsup" : "hand.thumbsup.fill", text: "post_like",
                active: post.myEmoji != nil)
        } primaryAction: {
            // A tap gives 👍, or takes back whichever reaction is this account's.
            onReact(post.myEmoji ?? likeEmoji)
        }
        .buttonStyle(.plain)
        .disabled(!canWrite)
        .accessibilityLabel(Text("post_like"))
        .accessibilityHint(Text("post_reactions_more"))
        .accessibilityAddTraits(post.myEmoji != nil ? [.isButton, .isSelected] : .isButton)
        .sheet(isPresented: $allEmoji) {
            EmojiSheet { emoji in
                allEmoji = false
                onReact(emoji)
            }
        }
    }

    /// The newest comment, and the pill that opens the post to write one.
    @ViewBuilder private var discussion: some View {
        NavigationLink(value: SocialRoute.post(post.postId)) {
            VStack(alignment: .leading, spacing: 8) {
                if let comment = post.latestComment, !isTombstone(comment) {
                    HStack(alignment: .top, spacing: 8) {
                        Avatar(
                            name: comment.author.name, kind: comment.author.verified == true ? .verified : .unverified,
                            size: 28, photo: comment.author.photoOf)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: authorName(comment.author))
                                .font(.sans(12.5, black: true))
                                .foregroundStyle(BrandTokens.Colors.fg)
                                .lineLimit(1)
                            Text(verbatim: comment.body)
                                .font(.sans(13.5))
                                .foregroundStyle(BrandTokens.Colors.fg)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: Radii.postBubble))
                    }
                }
                if canWrite {
                    Text("post_write_comment")
                        .font(.sans(14))
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 40)
                        .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: Radii.field))
                        .overlay { RoundedRectangle(cornerRadius: Radii.field).strokeBorder(BrandTokens.Colors.border) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// One of the three equal actions under a card: an icon and a word, as wide as the row has room for.
private struct ActionLabel: View {
    let systemImage: String
    let text: LocalizedStringKey
    let active: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .accessibilityHidden(true)
            Text(text)
                .font(.sans(13, black: true))
        }
        .foregroundStyle(active ? BrandTokens.Colors.primary : BrandTokens.Colors.mutedFg)
        .frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(Rectangle())
    }
}

/// What a post card offers at the end of its byline: reporting it, deleting it when it is this account's own and
/// pinning it, or taking the pin off, for a moderator or the owner; nothing when the screen has none of them
/// (decisions 0079, 0080).
private struct PostMenu: View {
    let pinned: Bool
    let onReport: (() -> Void)?
    let onDelete: (() -> Void)?
    let onPin: (() -> Void)?
    var onClosePoll: (() -> Void)?

    var body: some View {
        if onReport != nil || onDelete != nil || onPin != nil || onClosePoll != nil {
            Menu {
                if let onClosePoll {
                    Button(action: onClosePoll) {
                        Label("poll_close", systemImage: "lock")
                    }
                }
                if let onPin {
                    Button(action: onPin) {
                        if pinned {
                            Label("post_unpin", systemImage: "pin.slash")
                        } else {
                            Label("post_pin", systemImage: "pin")
                        }
                    }
                }
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

/// A comment, oldest first under its post, with the replies to it indented beneath it (decisions 0071, 0080): a grey
/// bubble with the person's picture, name and badge, a 👍 count on its corner when it has any, and under it
/// `{tími} · Líkar þetta · Svara`. This account's own has a delete, `onDelete`, which asks first. A comment a
/// moderator removed stands in as `comment_tombstone` while its replies are shown, with no actions.
struct CommentCard: View {
    let comment: Comment
    let onReport: () -> Void
    var onDelete: (() -> Void)?
    /// Writes a reply to this comment; nil on a reply, since one level is all a thread takes.
    var onReply: (() -> Void)?
    /// Gives the comment a 👍, or takes it back; nil for a reader who may not write here.
    var onLike: (() -> Void)?
    /// How many replies this comment has.
    var replies = 0

    var body: some View {
        if isTombstone(comment) {
            Text("comment_tombstone")
                .font(.sans(13.5))
                .italic()
                .foregroundStyle(BrandTokens.Colors.mutedFg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 6)
        } else {
            HStack(alignment: .top, spacing: 8) {
                Avatar(
                    name: comment.author.name, kind: comment.author.verified == true ? .verified : .unverified,
                    size: 32, photo: comment.author.photoOf)
                VStack(alignment: .leading, spacing: 4) {
                    StateMark(state: comment.state)
                    bubble
                    actions
                }
            }
        }
    }

    /// The name and the badge, which goes below the name when both do not fit on a line.
    @ViewBuilder private var commentByline: some View {
        NameWithMark(
            name: authorName(comment.author), verified: comment.author.verified == true, markSize: 11,
            font: .sans(13, black: true))
        RoleBadge(role: comment.author.role)
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 2) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 4) { commentByline }
                VStack(alignment: .leading, spacing: 2) { commentByline }
            }
            if !comment.body.isEmpty {
                Text(verbatim: comment.body)
                    .font(TypeStyle.bubble)
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            if let image = comment.images.first {
                CommentImage(postId: comment.postId, image: image)
                    .padding(.top, 4)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: Radii.postBubble))
        .overlay(alignment: .bottomTrailing) {
            if comment.likes > 0 {
                HStack(spacing: 3) {
                    Text(verbatim: likeEmoji).font(.system(size: 11))
                    Text(verbatim: "\(comment.likes)").font(.sans(11.5, black: true))
                }
                .foregroundStyle(BrandTokens.Colors.fg)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(BrandTokens.Colors.surface, in: Capsule())
                .overlay { Capsule().strokeBorder(BrandTokens.Colors.border) }
                .offset(x: 6, y: 10)
                .accessibilityElement(children: .combine)
            }
        }
    }

    /// The age, `Líkar þetta` (bold while this account's 👍 is on it) and `Svara`, then the flag and the delete.
    private var actions: some View {
        HStack(spacing: 12) {
            Text(verbatim: relativeTime(comment.createdAt))
                .font(TypeStyle.meta)
                .foregroundStyle(BrandTokens.Colors.mutedFg)
            Button {
                onLike?()
            } label: {
                Text("comment_like")
                    .font(.sans(12.5, black: comment.liked))
                    .foregroundStyle(comment.liked ? BrandTokens.Colors.primary : BrandTokens.Colors.mutedFg)
                    .frame(minHeight: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(onLike == nil)
            .accessibilityAddTraits(comment.liked ? [.isButton, .isSelected] : .isButton)
            if let onReply {
                Button(action: onReply) {
                    Text("comment_reply")
                        .font(.sans(12.5, black: true))
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
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
            Spacer(minLength: 0)
            if let onDelete { DeleteButton(action: onDelete) }
            ReportButton(action: onReport)
        }
        .padding(.leading, 4)
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
    @Environment(\.suspension) private var suspension

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
                    .disabled(!mayWrite(suspension))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .frame(minHeight: 40)
                    .background(
                        focused ? BrandTokens.Colors.surface : BrandTokens.Colors.muted,
                        in: RoundedRectangle(cornerRadius: Radii.field)
                    )
                    .overlay {
                        RoundedRectangle(cornerRadius: Radii.field)
                            .strokeBorder(focused ? BrandTokens.Colors.borderStrong : BrandTokens.Colors.border)
                    }
                    .onChange(of: draft) { _, text in
                        if text.count > limit { draft = String(text.prefix(limit)) }
                    }
                RoundButton(
                    systemImage: "arrow.up", label: send, fill: BrandTokens.Colors.primary,
                    tint: BrandTokens.Colors.primaryFg, size: 36, enabled: mayWrite(suspension, enabled),
                    action: onSend)
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
            .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: Radii.card))
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
                            let capped = ReportModel.capped(text)
                            if capped != text { model.note = capped }
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

/// Every emoji a reaction can be, to pick one from; the server takes any single emoji (decision 0100).
struct EmojiSheet: View {
    let onPick: (String) -> Void

    private static let faces =
        "😀😃😄😁😆😅🤣😂🙂😉😊😇🥰😍🤩😘😋😛😜🤪🤗🤭🤔🤨😐😑😶🙄😏😮😯😪😴😌😎🤓😕😟🙁😲😳🥺😦😧😨😰😢😭😱😖😞😓😩😠😡🤯😷🤒🤕"
    private static let symbols =
        "👍👎👏🙌🤝🙏💪👌✌️🤞🤟🤘👋🤙👀🔥✨🎉🎊💯💔❤️🧡💛💚💙💜🖤🤍💖💕✅❌⭐🌈☀️🌹🌱🍀🎶🏆🚀🇮🇸"
    private static let all: [String] = (faces + symbols).map { String($0) }

    var body: some View {
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 4) {
                ForEach(Self.all, id: \.self) { emoji in
                    Button {
                        onPick(emoji)
                    } label: {
                        Text(verbatim: emoji).font(.system(size: 28)).frame(minWidth: 44, minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: reactionLabel(emoji)))
                }
            }
            .padding(16)
        }
        .presentationDetents([.medium, .large])
        .accessibilityLabel(Text("post_reactions_all"))
    }
}
