import SpjallCore
import SwiftUI

/// The conversation list (1a): dense rows, newest first, as the core orders them.
struct ConversationsView: View {
    let model: ConversationsModel
    let onOpen: (String) -> Void
    let onNew: () -> Void
    let onInvite: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Header(onNew: onNew)
            ConnectionLine(connection: model.connection)
            if model.problem != nil || model.inviteExpired {
                VStack(spacing: 8) {
                    if let problem = model.problem {
                        ProblemCard(problem: problem) { Task { await model.load() } }
                    }
                    if model.inviteExpired { Notice(text: "link_expired") }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            ScrollView {
                LazyVStack(spacing: 0) {
                    if model.loaded && model.conversations.isEmpty {
                        InviteHint(text: "conversations_empty", onInvite: onInvite)
                    }
                    ForEach(model.conversations, id: \.id) { conversation in
                        Button {
                            onOpen(conversation.id)
                        } label: {
                            ConversationRow(conversation: conversation)
                        }
                        .buttonStyle(.plain)
                        Rectangle().fill(BrandTokens.Colors.border).frame(height: 1)
                    }
                }
            }
        }
        .background(BrandTokens.Colors.surface)
        // The title names the screen for the picker's back button; the header draws it.
        .navigationTitle(Text("tab_conversations"))
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.follow() }
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
                        Text(verbatim: listStamp(last.ts))
                            .font(Self.stamp)
                            .foregroundStyle(unread ? BrandTokens.Colors.primary : BrandTokens.Colors.mutedFg)
                    }
                }
                if unread {
                    UnreadBadge(count: Int(conversation.unread))
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 13)
        .background(unread ? BrandTokens.Colors.primarySubtle : Color.clear)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private static let stamp = Font.sans(10.5, black: true, relativeTo: .caption2)
}

private struct UnreadBadge: View {
    let count: Int

    var body: some View {
        Text(verbatim: "\(count)")
            .font(.sans(11, black: true, relativeTo: .caption))
            .foregroundStyle(BrandTokens.Colors.primaryFg)
            .padding(.horizontal, 6)
            .frame(minWidth: 20, minHeight: 20)
            .background(BrandTokens.Colors.primary, in: Capsule())
            .accessibilityLabel(Text(verbatim: plural("unread_count", count)))
    }
}
