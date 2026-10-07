import SpjallCore
import SwiftUI

/// The conversation list (1a): dense rows, newest first, as the core orders them.
struct ConversationsView: View {
    let model: ConversationsModel
    let onOpen: (String) -> Void
    let onNew: () -> Void
    let onInvite: () -> Void

    var body: some View {
        List {
            if model.connection != .online || model.problem != nil || model.inviteExpired {
                Section {
                    ConnectionLine(connection: model.connection)
                    if let problem = model.problem {
                        ProblemCard(problem: problem) { Task { await model.load() } }
                    }
                    if model.inviteExpired {
                        Text("link_expired")
                    }
                }
                .listRowSeparator(.hidden)
            }
            if model.loaded && model.conversations.isEmpty {
                InviteHint(text: "conversations_empty", onInvite: onInvite)
                    .listRowSeparator(.hidden)
            }
            ForEach(model.conversations, id: \.id) { conversation in
                Button {
                    onOpen(conversation.id)
                } label: {
                    ConversationRow(conversation: conversation)
                }
                .buttonStyle(.plain)
            }
        }
        .listStyle(.plain)
        .navigationTitle(Text("tab_conversations"))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button(action: onNew) { Label("new_conversation", systemImage: "square.and.pencil") }
            }
        }
        .task { await model.follow() }
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
        Text(text).font(.footnote).foregroundStyle(BrandTokens.Colors.mutedFg)
    }
}

private struct ConversationRow: View {
    let conversation: Conversation

    var body: some View {
        HStack(spacing: 12) {
            Avatar(name: conversation.members.first?.name)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(verbatim: title(conversation))
                        .font(.headline.weight(conversation.unread > 0 ? .bold : .regular))
                        .lineLimit(1)
                    // One member's mark: a group's title names several people.
                    if conversation.members.count == 1, conversation.members[0].verified {
                        VerifiedMark()
                    }
                }
                if let last = conversation.last {
                    Text(verbatim: lastLine(last))
                        .font(.subheadline)
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                if let last = conversation.last {
                    if last.status == .failed {
                        Text("message_failed").font(.caption).foregroundStyle(BrandTokens.Colors.danger)
                    } else {
                        Text(verbatim: shortTime(last.ts)).font(.caption).foregroundStyle(BrandTokens.Colors.mutedFg)
                    }
                }
                if conversation.unread > 0 {
                    UnreadBadge(count: Int(conversation.unread))
                }
            }
        }
        .frame(minHeight: 56)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

private struct UnreadBadge: View {
    let count: Int

    var body: some View {
        Text(verbatim: "\(count)")
            .font(.caption.bold())
            .foregroundStyle(BrandTokens.Colors.primaryFg)
            .padding(.horizontal, 6)
            .frame(minWidth: 20, minHeight: 20)
            .background(BrandTokens.Colors.primary, in: Capsule())
            .accessibilityLabel(Text(verbatim: plural("unread_count", count)))
    }
}
