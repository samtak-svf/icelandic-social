import SpjallCore
import SwiftUI

/// What an invited community tells the invited person (decision 0130): who invited them, or only that they were
/// invited when the invitation has no inviter. A deleted inviter reads as the word for a deleted account.
func invitationText(_ community: Community) -> String {
    guard let by = community.invitedBy else { return localized("community_invited") }
    return localized("community_invited_by", by.name ?? localized("person_deleted"))
}

/// An invitation that waits: its words, then the two answers. Accepting is the join call, which an invitation admits
/// at once; declining takes the invitation back, as a withdrawn join request does. The join request button is not
/// shown while an invitation stands.
struct InvitationAnswer: View {
    let community: Community
    let model: CommunityModel
    let writes: Bool

    var body: some View {
        Text(verbatim: invitationText(community))
            .font(.sans(13.5))
            .foregroundStyle(BrandTokens.Colors.mutedFg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        HStack(spacing: 8) {
            Button {
                Task { await model.join() }
            } label: {
                PillLabel(text: "community_accept_invite", filled: true)
            }
            .buttonStyle(.plain)
            .disabled(!writes || model.busy)
            Button {
                Task { await model.withdraw() }
            } label: {
                PillLabel(text: "community_decline_invite", filled: false)
            }
            .buttonStyle(.plain)
            .disabled(model.busy)
        }
    }
}
