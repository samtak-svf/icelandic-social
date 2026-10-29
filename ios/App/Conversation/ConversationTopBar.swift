import SpjallCore
import SwiftUI

/// The cream bar across the top: back, who this is with and whether Kenni
/// verified them, and the conversation's menu.
struct TopBar: View {
    let conversation: Conversation?
    let model: ConversationModel
    let writable: Bool
    @Binding var info: Bool

    @Environment(\.dismiss) private var dismiss
    @Environment(\.bell) private var bell

    private var verified: Bool {
        guard let conversation, conversation.name == nil, conversation.members.count == 1 else { return false }
        return conversation.members[0].verified
    }

    var body: some View {
        HStack(spacing: 10) {
            BackButton { dismiss() }
            if let conversation {
                // A tap on who this is opens the conversation's information (decisions 0043, 0055).
                Button {
                    info = true
                } label: {
                    who(conversation)
                }
                .buttonStyle(.plain)
                .disabled(!writable)
                .accessibilityHint(writable ? Text("conversation_info") : Text(verbatim: ""))
            }
            Spacer(minLength: 0)
            if let bell { BellButton(bell: bell) }
        }
        .padding(.leading, 4)
        .padding(.trailing, 8)
        .padding(.vertical, 6)
        .background(BrandTokens.Colors.bg.ignoresSafeArea(edges: .top))
        .overlay(alignment: .bottom) {
            Rectangle().fill(BrandTokens.Colors.border).frame(height: 1)
        }
    }

    private func who(_ conversation: Conversation) -> some View {
        let group = conversation.name != nil || conversation.members.count > 1
        return HStack(spacing: 10) {
            Avatar(
                name: group ? title(conversation) : conversation.members.first?.name,
                kind: avatarKind(conversation), size: 38, photo: photoOf(conversation))
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 5) {
                    Text(verbatim: title(conversation))
                        .font(.sans(15.5, black: true, relativeTo: .headline))
                        .foregroundStyle(BrandTokens.Colors.fg)
                        .lineLimit(1)
                    if verified { VerifiedMark() }
                }
                if verified {
                    // The mark already says it to VoiceOver.
                    Text("verified_short")
                        .font(.sans(11, relativeTo: .caption))
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                        .accessibilityHidden(true)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}
