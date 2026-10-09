import SpjallCore
import SwiftUI

/// Fljótið (decision 0034): what everyone writes, newest first, under a cream
/// band with the tab's name, a word that it is public, and the composer.
struct FeedView: View {
    let model: PostsModel
    let onAuthor: (Person) -> Void
    let onReplies: (String) -> Void

    @State private var composing = false

    var body: some View {
        VStack(spacing: 0) {
            Header { composing = true }
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
            }
            ScrollView {
                PostList(model: model, empty: "feed_empty", onAuthor: onAuthor, onReplies: onReplies)
            }
            .refreshable { await model.refresh() }
        }
        .background(BrandTokens.Colors.surface)
        // The title names the screen for the back button of what it leads to; the header draws it.
        .navigationTitle(Text("tab_feed"))
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $composing) {
            ComposerSheet(placeholder: "feed_composer_placeholder") { await model.post(body: $0) }
        }
        .task {
            if !model.loaded { await model.refresh() }
        }
    }
}

/// The cream band: the tab's name in capitals, that it is public, and the pill that opens the composer.
private struct Header: View {
    let onCompose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: localized("tab_feed").capitals)
                .font(TypeStyle.screenTitle)
                .foregroundStyle(BrandTokens.Colors.fg)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            Text("feed_public_notice")
                .font(.sans(12, relativeTo: .footnote))
                .foregroundStyle(BrandTokens.Colors.mutedFg)
                .fixedSize(horizontal: false, vertical: true)
            ComposerPill(placeholder: "feed_composer_placeholder", action: onCompose)
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandTokens.Colors.bg.ignoresSafeArea(edges: .top))
    }
}
