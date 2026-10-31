import SpjallCore
import SwiftUI

/// Fljótið (decision 0116): the composer prompt on top, then the cards, newest first, each naming its community
/// first and the sentinel that pages the list. The opening tab.
struct FeedView: View {
    let model: HomeModel
    @State private var composing = false
    @State private var sharing: String?
    @Environment(\.suspension) private var suspension

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(title: localized("tab_feed"))
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    SuspendedNotice()
                    composer
                    if let problem = model.problem {
                        ProblemCard(problem: problem) { Task { await model.retry() } }
                    }
                    if model.isEmptyForGood && model.problem == nil {
                        EmptyState(systemImage: "text.bubble", text: "feed_empty")
                    }
                    ForEach(model.posts, id: \.postId) { post in
                        PostCard(
                            post: post, linked: true, writes: model.writes(post), community: model.heading(post),
                            onReact: { emoji in Task { await model.react(post.postId, emoji) } },
                            onShare: { sharing = post.postId },
                            onVote: { option in Task { await model.vote(post.postId, option: option) } },
                            onWithdrawVote: { Task { await model.withdrawVote(post.postId) } },
                            onClosePoll: model.canClose(post) ? { Task { await model.closePoll(post.postId) } } : nil)
                    }
                    if model.isSearching || !model.loaded {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                    if model.next != nil {
                        Color.clear.frame(height: 1)
                            .task(id: model.wantsMore) { if model.wantsMore { await model.more() } }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .refreshable { await model.refresh() }
        }
        .background(BrandTokens.Colors.bg)
        .toolbar(.hidden, for: .navigationBar)
        .task { if !model.loaded { await model.load() } }
        .onChange(of: suspension, initial: true) { _, now in model.suspension = now }
        .sharingPost($sharing)
    }

    private var composer: some View {
        Button {
            composing = true
        } label: {
            PillLabel(text: "post_compose", filled: true)
        }
        .buttonStyle(.plain)
        .disabled(!mayWrite(suspension))
        .sheet(isPresented: $composing) {
            PostComposerSheet(
                draft: Binding(get: { model.draft }, set: { model.draft = $0 }),
                attachments: model.attachments, sendable: model.publishable, busy: model.busy,
                problem: model.problem, retry: { await model.retry() }, publish: { await model.publish() }
            ) {
                FeedComposerExtras(model: model)
            }
        }
    }
}
