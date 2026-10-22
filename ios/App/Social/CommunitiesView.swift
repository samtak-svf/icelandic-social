import SpjallCore
import SwiftUI

/// The communities hub (decisions 0063, 0079): what is new across this account's communities, the ones it is in,
/// a search over every one it may see, and, for a verified account, a new one.
struct CommunitiesView: View {
    let model: CommunitiesModel
    let onOpen: (String) -> Void

    @State private var creating = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(title: localized("tab_communities")) {
                if model.verified {
                    RoundButton(
                        systemImage: "plus", label: "community_create", fill: BrandTokens.Colors.primary,
                        tint: BrandTokens.Colors.primaryFg, size: 34, action: { creating = true })
                }
            }
            Picker("tab_communities", selection: part) {
                ForEach(CommunitiesPart.allCases) { part in
                    Text(verbatim: part.label).tag(part)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            if model.part == .discover {
                SocialSearchField(
                    prompt: "communities_find", text: Binding(get: { model.query }, set: { model.query = $0 }),
                    limit: communityNameLimit)
            }
            if model.busy || model.searching || model.loadingFeed {
                ProgressView().progressViewStyle(.linear)
            }
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    content
                }
                .animation(Motion.rows(reduceMotion: reduceMotion), value: shown)
            }
        }
        .background(BrandTokens.Colors.bg)
        .navigationTitle(Text("tab_communities"))
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.load() }
        .task(id: model.part) {
            switch model.part {
            case .feed: await model.loadFeed()
            case .mine: break
            case .discover: await model.search()
            }
        }
        .task(id: model.query) {
            // The search is the third part's; the other two never ask for it.
            guard model.part == .discover else { return }
            await model.search()
        }
        .sheet(isPresented: $creating) {
            CreateCommunitySheet(model: model)
        }
        .onChange(of: model.created) { _, id in
            guard let id else { return }
            creating = false
            model.opened()
            onOpen(id)
        }
    }

    private var part: Binding<CommunitiesPart> {
        Binding(get: { model.part }, set: { model.part = $0 })
    }

    /// The ids the list shows, in order: what its animation follows.
    private var shown: [String] {
        switch model.part {
        case .feed: model.feedPosts.map(\.postId)
        case .mine: model.mine.map(\.communityId)
        case .discover: model.found.map(\.communityId)
        }
    }

    @ViewBuilder private var content: some View {
        switch model.part {
        case .feed: feedList
        case .mine: mineList
        case .discover: discoverList
        }
    }

    /// What is new: one chronological feed across the communities this account is in, each card naming its own.
    @ViewBuilder private var feedList: some View {
        if model.feedLoaded && model.feedPosts.isEmpty && model.problem == nil {
            EmptyState(systemImage: "text.bubble", text: "communities_feed_empty")
        }
        ForEach(model.feedPosts, id: \.postId) { post in
            PostCard(
                post: post, linked: true, writes: model.writes(post),
                community: model.community(post.communityId)?.name,
                onReact: { kind in Task { await model.react(post.postId, kind) } }
            )
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
        }
        if model.feedNext != nil {
            Color.clear.frame(height: 1).task(id: model.feedNext) { await model.moreFeed() }
        }
    }

    @ViewBuilder private var mineList: some View {
        if model.loaded && model.mine.isEmpty && model.problem == nil {
            EmptyState(systemImage: "person.3", text: "communities_empty")
        }
        rows(model.mine)
    }

    @ViewBuilder private var discoverList: some View {
        if model.searched && !model.searching && model.found.isEmpty && model.problem == nil {
            EmptyState(systemImage: "magnifyingglass", text: "communities_none_found")
        }
        rows(model.found)
        if model.next != nil {
            Color.clear.frame(height: 1).task(id: model.next) { await model.more() }
        }
    }

    private func rows(_ communities: [Community]) -> some View {
        ForEach(communities, id: \.communityId) { community in
            Button {
                onOpen(community.communityId)
            } label: {
                CommunityRow(community: community)
            }
            .buttonStyle(.plain)
        }
    }
}

/// One community: its badge, name, audience and members, and the start of its description.
private struct CommunityRow: View {
    let community: Community

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                CommunityBadge(community: community)
                VStack(alignment: .leading, spacing: 3) {
                    Text(verbatim: community.name)
                        .font(.sans(14.5, black: true))
                        .foregroundStyle(BrandTokens.Colors.fg)
                        .lineLimit(1)
                    Text(verbatim: audienceLine(community))
                        .font(TypeStyle.meta)
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                    if !community.description.isEmpty {
                        Text(verbatim: community.description)
                            .font(.sans(13))
                            .foregroundStyle(BrandTokens.Colors.mutedFg)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            Hairline().padding(.leading, 72)
        }
        .frame(minHeight: 64)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// A new community: its name, a description, and whether it is open or private, each with what that means.
private struct CreateCommunitySheet: View {
    let model: CommunitiesModel

    @State private var name = ""
    @State private var description = ""
    @State private var audience = CommunityAudience.open
    @Environment(\.dismiss) private var dismiss

    private var ready: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.busy
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    CommunityTextFields(name: $name, description: $description)
                }
                Section {
                    CommunityAudiencePicker(audience: $audience)
                }
                if let problem = model.problem {
                    Section {
                        ProblemCard(problem: problem) { Task { await model.retry() } }
                    }
                }
                Section {
                    Button {
                        Task { await model.create(name: name, description: description, audience: audience) }
                    } label: {
                        Text("community_create").frame(maxWidth: .infinity)
                    }
                    .disabled(!ready)
                }
            }
            .navigationTitle(Text("community_create"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Text("cancel")
                    }
                }
            }
        }
    }
}
