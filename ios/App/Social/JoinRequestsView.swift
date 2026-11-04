import SpjallCore
import SwiftUI

/// The join requests that wait in a private community (#354): who asked and when, to approve or decline.
struct JoinRequestsView: View {
    let model: JoinRequestsModel

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if !model.loaded {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
                if model.loaded && model.requests.isEmpty && model.invitations.isEmpty && model.problem == nil {
                    EmptyState(systemImage: "person.crop.circle.badge.questionmark", text: "join_requests_empty")
                }
                ForEach(model.requests, id: \.accountId) { request in
                    RequestCard(request: request, model: model)
                }
                if !model.invitations.isEmpty {
                    Text("community_invitations_pending")
                        .font(.sans(14, black: true))
                        .foregroundStyle(BrandTokens.Colors.fg)
                        .padding(.top, 8)
                    ForEach(model.invitations, id: \.accountId) { invitation in
                        InvitationCard(invitation: invitation, model: model)
                    }
                }
            }
            .padding(16)
        }
        .background(BrandTokens.Colors.bg)
        .navigationTitle(Text("join_requests_title"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .bellInNavigationBar()
        .problemCard(model.problem) { Task { await model.retry() } }
        .task { await model.load() }
    }
}

/// One request: the account's name with its verified mark and when it asked, then the two answers.
private struct RequestCard: View {
    let request: JoinRequest
    let model: JoinRequestsModel

    private var author: Author {
        Author(accountId: request.accountId, name: request.name, verified: request.verified)
    }

    var body: some View {
        Panel {
            VStack(alignment: .leading, spacing: 10) {
                Byline(author: author, createdAt: request.requestedAt)
                HStack(spacing: 8) {
                    Button {
                        Task { await model.approve(request) }
                    } label: {
                        PillLabel(text: "join_request_approve", filled: true, wide: false)
                    }
                    .buttonStyle(.plain)
                    .disabled(model.answering != nil)
                    Button {
                        Task { await model.decline(request) }
                    } label: {
                        PillLabel(text: "join_request_decline", filled: false, wide: false)
                    }
                    .buttonStyle(.plain)
                    .disabled(model.answering != nil)
                }
            }
            .padding(14)
        }
    }
}

/// One pending invitation: the invited account's name, who invited it when that is known, and the way to take it back.
private struct InvitationCard: View {
    let invitation: CommunityInvitation
    let model: JoinRequestsModel

    var body: some View {
        Panel {
            VStack(alignment: .leading, spacing: 10) {
                Text(verbatim: invitation.name ?? localized("person_unnamed"))
                    .font(.sans(14, black: true))
                    .foregroundStyle(BrandTokens.Colors.fg)
                if let by = invitation.invitedBy {
                    Text(verbatim: localized("community_invitation_from", by.name ?? localized("person_deleted")))
                        .font(TypeStyle.meta)
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                }
                Button {
                    Task { await model.withdraw(invitation) }
                } label: {
                    PillLabel(text: "community_withdraw_invite", filled: false, wide: false)
                }
                .buttonStyle(.plain)
                .disabled(model.answering != nil)
            }
            .padding(14)
        }
    }
}
