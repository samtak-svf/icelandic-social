import SpjallCore
import SwiftUI

/// Fljótið (decision 0034): what everyone writes, newest first, under a cream
/// band with the tab's name, a short line that it is public, and the composer.
/// The line's button says the rest. Newer posts a refresh brings while the reader
/// is further down are offered in a pill that goes back to the top (decision 0043).
struct FeedView: View {
    let model: PostsModel
    let onAuthor: (Person) -> Void
    let onReplies: (String) -> Void

    @State private var composing = false
    @State private var explaining = false
    /// The reader has scrolled away from the newest post.
    @State private var down = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let top = "top"

    var body: some View {
        VStack(spacing: 0) {
            Header(onCompose: { composing = true }, onMore: { explaining = true })
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
            }
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 0) {
                        Color.clear
                            .frame(height: 0)
                            .id(Self.top)
                            .onGeometryChange(for: Bool.self, of: { $0.frame(in: .scrollView).minY < -1 }) { down = $0 }
                        PostList(
                            model: model, empty: "feed_empty", emptyIcon: "water.waves", onAuthor: onAuthor,
                            onReplies: onReplies)
                    }
                }
                .refreshable { await model.refresh() }
                .overlay(alignment: .top) {
                    if model.newer && down {
                        NewPostsPill {
                            model.seenNewer()
                            withAnimation(reduceMotion ? nil : .default) { proxy.scrollTo(Self.top, anchor: .top) }
                        }
                        .padding(.top, 8)
                    }
                }
            }
        }
        // At the top the newer posts are in sight already: nothing to offer.
        .onChange(of: model.newer && !down) { _, seen in
            if seen { model.seenNewer() }
        }
        .background(BrandTokens.Colors.surface)
        // The title names the screen for the back button of what it leads to; the header draws it.
        .navigationTitle(Text("tab_feed"))
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $composing) {
            ComposerSheet(placeholder: "feed_composer_placeholder") { await model.post(body: $0) }
        }
        .sheet(isPresented: $explaining) {
            PublicNotice()
        }
        .task {
            if !model.loaded { await model.refresh() }
        }
    }
}

/// The cream band: the tab's name in capitals, a short line that it is public with a button for the
/// rest, and the pill that opens the composer.
private struct Header: View {
    let onCompose: () -> Void
    let onMore: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: localized("tab_feed").capitals)
                .font(TypeStyle.screenTitle)
                .foregroundStyle(BrandTokens.Colors.fg)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 0) {
                Text("feed_public_short")
                    .font(.sans(12, relativeTo: .footnote))
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
                Button(action: onMore) {
                    Image(systemName: "info.circle")
                        .font(.system(size: 15))
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("feed_public_more"))
            }
            ComposerPill(placeholder: "feed_composer_placeholder", action: onCompose)
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandTokens.Colors.bg.ignoresSafeArea(edges: .top))
    }
}

/// The whole sentence the short line stands for (decision 0034): who sees what is written here.
private struct PublicNotice: View {
    var body: some View {
        ScrollView {
            Text("feed_public_notice")
                .font(.sans(16))
                .foregroundStyle(BrandTokens.Colors.fg)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

/// "Newer posts": back to the top, where they are.
private struct NewPostsPill: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text("feed_new_posts")
                .font(.sans(14, black: true))
                .foregroundStyle(BrandTokens.Colors.primaryFg)
                .padding(.horizontal, 20)
                .frame(minHeight: 44)
                .background(BrandTokens.Colors.primary, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
