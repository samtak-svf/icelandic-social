import SpjallCore
import SwiftUI

/// The anonymous posts that wait for a moderator (decision 0091): each with its text, to publish, to decline, or to
/// ask who wrote it.
struct AnonymousQueueView: View {
    let model: AnonymousQueueModel

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if !model.loaded {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
                if model.loaded && model.posts.isEmpty && model.problem == nil {
                    EmptyState(systemImage: "eye.slash", text: "anonymous_queue_empty")
                }
                if !model.posts.isEmpty {
                    Text(verbatim: plural("anonymous_queue_waiting", model.posts.count))
                        .font(.sans(13))
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                }
                ForEach(model.posts, id: \.postId) { post in
                    QueuedPostCard(post: post, model: model)
                }
                if model.next != nil {
                    Color.clear.frame(height: 1).task(id: model.next) { await model.more() }
                }
            }
            .padding(16)
        }
        .background(BrandTokens.Colors.bg)
        .navigationTitle(Text("anonymous_queue_title"))
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

/// One waiting post: what it says, who wrote it once a moderator asked, then the three actions.
private struct QueuedPostCard: View {
    let post: Post
    let model: AnonymousQueueModel

    var body: some View {
        Panel {
            VStack(alignment: .leading, spacing: 10) {
                Text(verbatim: post.body)
                    .font(.sans(15))
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let author = model.revealed[post.postId] {
                    RevealedAuthorLine(author: author)
                }
                HStack(spacing: 8) {
                    Button {
                        Task { await model.approve(post) }
                    } label: {
                        PillLabel(text: "anonymous_approve", filled: true, wide: false)
                    }
                    .buttonStyle(.plain)
                    Button {
                        Task { await model.decline(post) }
                    } label: {
                        PillLabel(text: "anonymous_decline", filled: false, wide: false)
                    }
                    .buttonStyle(.plain)
                    if model.revealed[post.postId] == nil {
                        RevealAuthorButton { Task { await model.reveal(post) } }
                    }
                }
                .disabled(model.answering != nil)
            }
            .padding(14)
        }
    }
}
