import SpjallCore
import SwiftUI

/// The conversation list (1a): dense rows, newest first, as the core orders them. While the system
/// blocks the app's notifications, a notice above the rows says so, since nothing else would. A search
/// under the header shows the conversations it found, then the people ("Fólk") from the directory.
struct ConversationsView: View {
    let model: ConversationsModel
    let notificationsOff: Bool
    let onOpen: (String) -> Void
    let onNew: () -> Void
    let onInvite: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Header(onNew: onNew)
            SearchField(query: Binding(get: { model.query }, set: { model.query = $0 }))
            if model.searching {
                ProgressView().progressViewStyle(.linear)
            }
            ConnectionLine(connection: model.connection)
            if model.problem != nil || model.inviteExpired || notificationsOff {
                VStack(spacing: 8) {
                    if let problem = model.problem {
                        ProblemCard(problem: problem) { Task { await model.retry() } }
                    }
                    if model.inviteExpired { Notice(text: "link_expired") }
                    if notificationsOff { NotificationsOff() }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            ScrollView {
                LazyVStack(spacing: 0) {
                    if model.searched {
                        if let found = model.found {
                            results(found)
                        }
                    } else {
                        if model.loaded && model.conversations.isEmpty {
                            InviteHint(text: "conversations_empty", onInvite: onInvite)
                        }
                        rows(model.conversations)
                    }
                }
            }
        }
        .background(BrandTokens.Colors.surface)
        // The title names the screen for the picker's back button; the header draws it.
        .navigationTitle(Text("tab_conversations"))
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.follow() }
        .task(id: model.query) { await model.search() }
    }

    private func rows(_ conversations: [Conversation]) -> some View {
        ForEach(conversations, id: \.id) { conversation in
            Button {
                onOpen(conversation.id)
            } label: {
                ConversationRow(conversation: conversation)
            }
            .buttonStyle(.plain)
            Rectangle().fill(BrandTokens.Colors.border).frame(height: 1)
        }
    }

    /// What a search found: the conversations first, then the people under their own heading.
    @ViewBuilder
    private func results(_ found: ConversationsModel.Found) -> some View {
        if found.conversations.isEmpty && found.people.isEmpty && !model.searching {
            Text("conversations_none_found")
                .font(.sans(15, relativeTo: .body))
                .foregroundStyle(BrandTokens.Colors.fg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
        }
        rows(found.conversations)
        if !found.people.isEmpty {
            Text("conversations_people")
                .font(.sans(13, black: true, relativeTo: .subheadline))
                .foregroundStyle(BrandTokens.Colors.fg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 4)
                .accessibilityAddTraits(.isHeader)
            ForEach(found.people, id: \.account) { person in
                Button {
                    Task {
                        if let id = await model.openPerson(person.account) { onOpen(id) }
                    }
                } label: {
                    PersonRow(person: person)
                }
                .buttonStyle(.plain)
                Rectangle().fill(BrandTokens.Colors.border).frame(height: 1)
            }
        }
    }
}

/// The name search under the header (decision 0038).
private struct SearchField: View {
    @Binding var query: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(BrandTokens.Colors.mutedFg)
                .accessibilityHidden(true)
            TextField(text: $query, prompt: Text("conversations_search")) {
                Text("conversations_search")
            }
            .textInputAutocapitalization(.words)
            .autocorrectionDisabled()
            .submitLabel(.search)
            .onChange(of: query) { _, text in
                // The longest search the server and the core take (decision 0036).
                if text.count > 100 { query = String(text.prefix(100)) }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(BrandTokens.Colors.bg, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(BrandTokens.Colors.border))
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}

/// Someone the search found in the directory: a tap opens the 1:1.
private struct PersonRow: View {
    let person: Person

    var body: some View {
        HStack(spacing: 12) {
            Avatar(name: person.name, kind: person.verified ? .verified : .unverified)
            Text(verbatim: shownName(person))
                .font(.sans(14.5, black: true))
                .foregroundStyle(BrandTokens.Colors.fg)
                .lineLimit(1)
            if person.verified { VerifiedMark() }
            Spacer(minLength: 8)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 13)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// The cream band: the tab's name in capitals, and a round button for a new conversation.
private struct Header: View {
    let onNew: () -> Void

    var body: some View {
        HStack {
            Text(verbatim: localized("tab_conversations").capitals)
                .font(TypeStyle.screenTitle)
                .foregroundStyle(BrandTokens.Colors.fg)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            RoundButton(
                systemImage: "plus", label: "new_conversation", fill: BrandTokens.Colors.primary,
                tint: BrandTokens.Colors.primaryFg, size: 34, action: onNew)
        }
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .padding(.vertical, 4)
        .background(BrandTokens.Colors.bg.ignoresSafeArea(edges: .top))
    }
}

/// A short notice on the gold wash.
private struct Notice: View {
    let text: LocalizedStringKey

    var body: some View {
        Text(text)
            .font(.sans(13))
            .foregroundStyle(BrandTokens.Colors.fg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(BrandTokens.Colors.secondarySubtle, in: RoundedRectangle(cornerRadius: 14))
    }
}

/// Shown only while the socket is not open (decision 0022).
private struct ConnectionLine: View {
    let connection: Connection

    var body: some View {
        switch connection {
        case .online:
            EmptyView()
        case .connecting:
            line("connection_connecting")
        case .offline:
            line("connection_offline")
        }
    }

    private func line(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.sans(12, relativeTo: .footnote))
            .foregroundStyle(BrandTokens.Colors.mutedFg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 6)
    }
}

private struct ConversationRow: View {
    let conversation: Conversation

    private var unread: Bool { conversation.unread > 0 }
    private var muted: Bool { conversation.mute != .off }
    /// Unread and not muted: only then does the row ask for attention (decision 0042).
    private var calling: Bool { unread && !muted }
    private var group: Bool { conversation.members.count > 1 }

    var body: some View {
        HStack(spacing: 12) {
            // A group's circle carries the group's initials, a 1:1's the other person's.
            Avatar(
                name: group ? title(conversation) : conversation.members.first?.name, kind: avatarKind(conversation))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Text(verbatim: title(conversation))
                        .font(.sans(14.5, black: true))
                        .foregroundStyle(BrandTokens.Colors.fg)
                        .lineLimit(1)
                    // One member's mark: a group's title names several people.
                    if conversation.members.count == 1, conversation.members[0].verified {
                        VerifiedMark()
                    }
                }
                if let last = conversation.last {
                    Text(verbatim: previewLine(last, group: group))
                        .font(.sans(12.5, relativeTo: .subheadline))
                        .foregroundStyle(BrandTokens.Colors.proseBody)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 6) {
                if let last = conversation.last {
                    if last.status == .failed {
                        Text("message_failed").font(Self.stamp).foregroundStyle(BrandTokens.Colors.danger)
                    } else {
                        HStack(spacing: 4) {
                            if muted { MutedMark() }
                            Text(verbatim: listStamp(last.ts))
                                .font(Self.stamp)
                                .foregroundStyle(calling ? BrandTokens.Colors.primary : BrandTokens.Colors.mutedFg)
                        }
                    }
                }
                if unread {
                    UnreadBadge(count: Int(conversation.unread), muted: muted)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 13)
        .background(calling ? BrandTokens.Colors.primarySubtle : Color.clear)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private static let stamp = Font.sans(10.5, black: true, relativeTo: .caption2)
}

/// A muted conversation: the bell struck through, said by its label.
private struct MutedMark: View {
    var body: some View {
        Image(systemName: "bell.slash.fill")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(BrandTokens.Colors.mutedFg)
            .accessibilityLabel(Text("muted"))
    }
}

/// The unread count; a muted conversation still counts, in the quiet colour.
private struct UnreadBadge: View {
    let count: Int
    let muted: Bool

    var body: some View {
        Text(verbatim: "\(count)")
            .font(.sans(11, black: true, relativeTo: .caption))
            .foregroundStyle(muted ? BrandTokens.Colors.fg : BrandTokens.Colors.primaryFg)
            .padding(.horizontal, 6)
            .frame(minWidth: 20, minHeight: 20)
            .background(muted ? BrandTokens.Colors.muted : BrandTokens.Colors.primary, in: Capsule())
            .accessibilityLabel(Text(verbatim: plural("unread_count", count)))
    }
}
