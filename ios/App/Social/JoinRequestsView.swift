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
                if model.loaded && model.requests.isEmpty && model.problem == nil {
                    EmptyState(systemImage: "person.crop.circle.badge.questionmark", text: "join_requests_empty")
                }
                ForEach(model.requests, id: \.accountId) { request in
                    RequestCard(request: request, model: model)
                }
            }
            .padding(16)
        }
        .background(BrandTokens.Colors.bg)
        .navigationTitle(Text("join_requests_title"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .bellInNavigationBar()
        .safeAreaInset(edge: .top) {
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
            }
        }
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
