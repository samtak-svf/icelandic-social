import SpjallCore
import SwiftUI

/// One post (decision 0063), its reactions, and its comments oldest first; a member of its community who is
/// not muted writes a comment at the foot.
struct PostView: View {
    let model: PostModel
    let social: Social

    @State private var reporting: Reporting?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if let post = model.post {
                    PostCard(
                        post: post, linked: false, writes: model.writes,
                        onReact: { kind in Task { await model.react(kind) } },
                        onReport: { reporting = Reporting(target: ReportTarget(kind: .post, id: post.postId)) })
                    if model.muted {
                        SocialNote(text: "community_muted")
                    }
                    comments
                } else if !model.loaded {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(16)
        }
        .background(BrandTokens.Colors.bg)
        .navigationTitle(Text(verbatim: model.community?.name ?? ""))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .safeAreaInset(edge: .top) {
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if model.writes {
                SocialComposer(
                    placeholder: "comment_compose", send: "comment_publish",
                    draft: Binding(get: { model.draft }, set: { model.draft = $0 }),
                    limit: PostModel.commentLimit, enabled: model.sendable && !model.busy,
                    onSend: { Task { await model.publish() } })
            }
        }
        .sheet(item: $reporting) { reporting in
            ReportSheet(social: social, target: reporting.target)
        }
        .task { await model.load() }
    }

    @ViewBuilder private var comments: some View {
        if model.loaded && model.comments.isEmpty && model.next == nil && model.problem == nil {
            EmptyState(systemImage: "text.bubble", text: "comments_empty")
        }
        if !model.comments.isEmpty {
            Panel {
                ForEach(Array(model.comments.enumerated()), id: \.element.commentId) { index, comment in
                    if index > 0 { Hairline() }
                    CommentCard(comment: comment) {
                        reporting = Reporting(target: ReportTarget(kind: .comment, id: comment.commentId))
                    }
                }
            }
        }
        if model.next != nil {
            Color.clear.frame(height: 1).task(id: model.next) { await model.more() }
        }
    }
}
