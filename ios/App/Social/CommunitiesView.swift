import SpjallCore
import SwiftUI

/// The communities hub (decisions 0063, 0079): what is new across this account's communities, the ones it is in,
/// a search over every one it may see, and, for a verified account, a new one.
struct CommunitiesView: View {
    let model: CommunitiesModel
    let onOpen: (String) -> Void

    @State private var creating = false
    @State private var sharing: String?
    /// The search field is open: it sits behind the header's search icon, not on the screen (decision 0080).
    @State private var searchOpen = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layout) private var layout

    /// The reader's communities sit in a column beside the feed, and the three tabs are gone (decision 0087).
    private var column: Bool { layout.hub == .column }

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(title: localized("tab_communities")) {
                RoundButton(
                    systemImage: "magnifyingglass", label: "communities_search_open", fill: BrandTokens.Colors.muted,
                    tint: BrandTokens.Colors.fg, size: 34,
                    action: {
                        searchOpen = true
                        // Beside the column the search toggles `Finna` and the feed.
                        model.part = column && model.part == .discover ? .feed : .discover
                    })
            }
            if !column {
                Picker("tab_communities", selection: part) {
                    ForEach(CommunitiesPart.allCases) { part in
                        Text(verbatim: part.label).tag(part)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
            }
            if model.part == .discover && (searchOpen || model.searched) {
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
            HStack(alignment: .top, spacing: 0) {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        content
                    }
                    .animation(Motion.rows(reduceMotion: reduceMotion), value: shown)
                }
                if column {
                    Rectangle().fill(BrandTokens.Colors.border).frame(width: 1)
                    hubColumn
                }
            }
        }
        .background(BrandTokens.Colors.bg)
        .navigationTitle(Text("tab_communities"))
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.load() }
        .task(id: model.part) {
            switch model.part {
            case .feed: await model.loadFeed()
            case .mine: await model.loadFeed()
            case .discover: await model.search()
            }
        }
        .task(id: model.query) {
            // The search is the third part's; the other two never ask for it.
            guard model.part == .discover else { return }
            await model.search()
        }
        // Beside the live preview the form needs the room a sheet does not have (decision 0087).
        .sheet(isPresented: Binding(get: { creating && layout.create == .form }, set: { creating = $0 })) {
            CreateCommunitySheet(model: model)
        }
        .fullScreenCover(
            isPresented: Binding(get: { creating && layout.create == .formAndPreview }, set: { creating = $0 })
        ) {
            CreateCommunitySheet(model: model)
        }
        .onChange(of: column, initial: true) {
            // `communities_tab_mine` is the column's now; the main pane keeps the feed.
            if column && model.part == .mine { model.part = .feed }
        }
        .sharingPost($sharing)
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
        case .mine: model.mine.map(\.communityId) + model.feedPosts.map(\.postId)
        case .discover: model.found.map(\.communityId)
        }
    }

    @ViewBuilder private var content: some View {
        switch model.part {
        case .feed: feedList
        case .mine where column: feedList
        case .mine: mineList
        case .discover: discoverList
        }
    }

    /// What is new: one chronological feed across the communities this account is in, each card naming its own.
    @ViewBuilder private var feedList: some View {
        if model.feedLoaded && model.feedPosts.isEmpty && model.problem == nil {
            EmptyState(systemImage: "text.bubble", text: "communities_feed_empty")
        }
        feedRows
    }

    /// The feed's cards and the sentinel that pages it: shared by the feed part and the `communities_tab_mine` one,
    /// so there is one feed state and one way to draw it.
    @ViewBuilder private var feedRows: some View {
        ForEach(model.feedPosts, id: \.postId) { post in
            PostCard(
                post: post, linked: true, writes: model.writes(post),
                community: model.community(post.communityId),
                onReact: { emoji in Task { await model.react(post.postId, emoji) } },
                onShare: { sharing = post.postId },
                onVote: { option in Task { await model.vote(post.postId, option: option) } },
                onWithdrawVote: { Task { await model.withdrawVote(post.postId) } },
                onClosePoll: model.canClose(post) ? { Task { await model.closePoll(post.postId) } } : nil
            )
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
        }
        if model.feedNext != nil {
            Color.clear.frame(height: 1).task(id: model.feedNext) { await model.moreFeed() }
        }
    }

    /// The reader's communities beside the feed (decision 0087), in the order the server gives: pinned first, then by
    /// last activity, each row with its count of new posts.
    private var hubColumn: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                Text("communities_mine")
                    .font(.sans(15, black: true))
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .accessibilityAddTraits(.isHeader)
                if model.verified {
                    CreateRow { creating = true }
                }
                if model.loaded && model.mine.isEmpty && model.problem == nil {
                    EmptyState(systemImage: "person.3", text: "communities_empty")
                }
                rows(model.mine)
            }
        }
        .frame(width: Self.columnWidth)
    }

    /// The column's width.
    private static let columnWidth: CGFloat = 340

    @ViewBuilder private var mineList: some View {
        if model.verified {
            CreateRow { creating = true }
        }
        if model.loaded && model.mine.isEmpty && model.problem == nil {
            EmptyState(systemImage: "person.3", text: "communities_empty")
        }
        rows(model.mine)
        if !model.mine.isEmpty {
            Text("communities_from_yours")
                .font(.sans(13, black: true))
                .foregroundStyle(BrandTokens.Colors.mutedFg)
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 4)
                .accessibilityAddTraits(.isHeader)
            feedRows
        }
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
            .contextMenu {
                // A pin is this account's own list, so only a community it is in can be pinned.
                if community.role != nil {
                    Button {
                        Task { await model.pin(community.communityId, !community.pinned) }
                    } label: {
                        if community.pinned {
                            Label("community_unpin", systemImage: "pin.slash")
                        } else {
                            Label("community_pin", systemImage: "pin")
                        }
                    }
                }
            }
        }
    }
}

/// `community_create`, the first row of `communities_tab_mine`: it opens the create screen (decision 0080).
private struct CreateRow: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    RoundIcon(
                        systemImage: "plus", fill: BrandTokens.Colors.primary, tint: BrandTokens.Colors.primaryFg,
                        size: 40
                    )
                    VStack(alignment: .leading, spacing: 3) {
                        Text("community_create")
                            .font(.sans(14.5, black: true))
                            .foregroundStyle(BrandTokens.Colors.fg)
                        Text("communities_create_row_hint")
                            .font(TypeStyle.meta)
                            .foregroundStyle(BrandTokens.Colors.mutedFg)
                    }
                    Spacer(minLength: 8)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
                Hairline().padding(.leading, 72)
            }
            .frame(minHeight: 64)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isButton)
    }
}

/// One community: its badge, its name, and the last activity: bold with the count of new posts and a dot while the
/// reader has not seen them, else when the community was last written in (decision 0080).
private struct CommunityRow: View {
    let community: Community

    private var unread: Bool { community.unread > 0 }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                CommunityBadge(community: community)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(verbatim: community.name)
                            .font(.sans(14.5, black: unread))
                            .foregroundStyle(BrandTokens.Colors.fg)
                            .lineLimit(1)
                        if community.pinned {
                            Image(systemName: "pin.fill")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(BrandTokens.Colors.mutedFg)
                                .accessibilityLabel(Text("community_pinned"))
                        }
                    }
                    activity
                    if !community.description.isEmpty {
                        Text(verbatim: community.description)
                            .font(.sans(13))
                            .foregroundStyle(BrandTokens.Colors.mutedFg)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 8)
                if unread {
                    Circle()
                        .fill(BrandTokens.Colors.primary)
                        .frame(width: 10, height: 10)
                        .accessibilityHidden(true)
                }
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

    /// The count of new posts, or the age of the last one, or, for a community nobody has written in, who it is for.
    @ViewBuilder private var activity: some View {
        if unread {
            Text(verbatim: plural("community_new_posts", Int(community.unread)))
                .font(.sans(12.5, black: true))
                .foregroundStyle(BrandTokens.Colors.primary)
        } else if let last = community.lastPostAt {
            Text(verbatim: relativeTime(last))
                .font(TypeStyle.meta)
                .foregroundStyle(BrandTokens.Colors.mutedFg)
        } else {
            Text(verbatim: audienceLine(community))
                .font(TypeStyle.meta)
                .foregroundStyle(BrandTokens.Colors.mutedFg)
        }
    }
}

/// A new community: its name, a description, and whether it is open or private, each with what that means.
private struct CreateCommunitySheet: View {
    let model: CommunitiesModel

    @State private var name = ""
    @State private var description = ""
    @State private var audience = CommunityAudience.open
    /// The picks, kept until the community is made (decision 0080).
    @State private var picture: Picked?
    @State private var cover: Picked?
    /// How the person framed each pick in the crop sheet, sent after the community exists (decision 0086).
    @State private var pictureFraming: Framing?
    @State private var coverFraming: Framing?
    @State private var framing: FrameRequest?
    @Environment(\.dismiss) private var dismiss

    private var ready: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.busy
    }

    /// A pick goes to the crop sheet before it is kept; Cancel drops it (decision 0086).
    private func frame(_ pick: Picked, cover isCover: Bool) {
        Task {
            guard let master = try? await masterFile(pick) else {
                // Not an image the sheet can open: kept as it is, so the creation reports it as it always did.
                if isCover { cover = pick; coverFraming = nil } else { picture = pick; pictureFraming = nil }
                return
            }
            framing = FrameRequest(kind: isCover ? .cover : .photo, master: master, start: nil) { framed in
                try? FileManager.default.removeItem(at: master)
                guard let framed else { return }
                if isCover { cover = pick; coverFraming = framed } else { picture = pick; pictureFraming = framed }
            }
        }
    }

    @Environment(\.layout) private var layout
    /// The picks as images, for the preview beside the form.
    @State private var pictureImage: UIImage?
    @State private var coverImage: UIImage?

    var body: some View {
        if layout.create == .formAndPreview {
            // The form beside a live preview of the header, at the reader's own size class (decision 0087).
            HStack(spacing: 0) {
                form.frame(maxWidth: 520)
                CommunityPreview(
                    name: name, description: description, audience: audience, picture: pictureImage,
                    cover: coverImage
                )
                .frame(maxWidth: .infinity)
            }
        } else {
            form
        }
    }

    private var form: some View {
        NavigationStack {
            Form {
                Section {
                    CommunityTextFields(name: $name, description: $description)
                }
                Section {
                    CommunityPictureFields(
                        hasPicture: picture != nil, hasCover: cover != nil,
                        onPicture: { frame($0, cover: false) }, onCover: { frame($0, cover: true) },
                        onRemovePicture: {
                            picture = nil; pictureFraming = nil
                        },
                        onRemoveCover: {
                            cover = nil; coverFraming = nil
                        })
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
                        let makePicture: (@Sendable () async throws -> URL)? = picture.map { pick in
                            { @Sendable in try await masterFile(pick) }
                        }
                        let makeCover: (@Sendable () async throws -> URL)? = cover.map { pick in
                            { @Sendable in try await masterFile(pick) }
                        }
                        Task {
                            await model.create(
                                name: name, description: description, audience: audience,
                                picture: makePicture, cover: makeCover,
                                pictureFraming: pictureFraming, coverFraming: coverFraming)
                        }
                    } label: {
                        Text("community_create").frame(maxWidth: .infinity)
                    }
                    .disabled(!ready)
                }
            }
            .navigationTitle(Text("community_create"))
            .navigationBarTitleDisplayMode(.inline)
            .frameSheet($framing)
            .task(id: pickKey(picture)) { pictureImage = await previewImage(picture) }
            .task(id: pickKey(cover)) { coverImage = await previewImage(cover) }
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

/// A pick as an image for the preview, nil when there is none or it cannot be read.
private func previewImage(_ pick: Picked?) async -> UIImage? {
    guard let pick, let master = try? await masterFile(pick) else { return nil }
    defer { try? FileManager.default.removeItem(at: master) }
    return UIImage(contentsOfFile: master.path)
}

/// A key that changes when the pick does, for `.task(id:)`: `Picked` is not Equatable.
private func pickKey(_ pick: Picked?) -> String {
    pick.map { "\($0.name ?? "")/\($0.size ?? 0)/\($0.mime)" } ?? ""
}

/// The community's header as it will look once made (decision 0087): the same `CommunityHeadline` the community screen
/// draws, with the name, audience line and description typed so far and the picture and cover just picked.
private struct CommunityPreview: View {
    let name: String
    let description: String
    let audience: CommunityAudience
    let picture: UIImage?
    let cover: UIImage?

    /// A community not made yet, only for the preview's sake.
    private var draft: Community {
        Community(
            communityId: "", name: name, description: description, audience: audience, createdAt: 0, memberCount: nil,
            role: .owner, joinRequested: false, invited: false, mutedUntil: nil, readOnly: false, deletedAt: nil,
            joinDeclinedUntil: nil, pendingJoinRequests: nil)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                CommunityHeadline(name: name) {
                    CoverBand(community: draft, local: cover)
                } picture: {
                    if let picture {
                        Image(uiImage: picture)
                            .resizable()
                            .scaledToFill()
                            .frame(width: communityPictureSize, height: communityPictureSize)
                            .clipShape(RoundedRectangle(cornerRadius: communityPictureSize * 0.28))
                    } else {
                        CommunityBadge(community: draft, size: communityPictureSize)
                    }
                } trailing: {
                    EmptyView()
                }
                HStack(spacing: 6) {
                    Image(systemName: audience == .open ? "globe" : "lock.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                        .accessibilityHidden(true)
                    Text(verbatim: audienceLineFull(draft))
                        .font(TypeStyle.meta)
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                }
                if !description.isEmpty {
                    Text(verbatim: description)
                        .font(.sans(14))
                        .foregroundStyle(BrandTokens.Colors.proseBody)
                        .lineLimit(3)
                }
            }
            .padding(24)
            .frame(maxWidth: contentWidth)
        }
        .background(BrandTokens.Colors.bg)
        .accessibilityElement(children: .combine)
    }
}
