import PhotosUI
import SpjallCore
import SwiftUI

/// One community (decisions 0063, 0079): a compact header whose name, audience and info button lead to
/// `community_info` and, for a moderator, `Stjórna`; joining, taking a request back or leaving it; its posts,
/// newest first, searchable, this account's own with a delete. A member who is not muted writes in a sheet that
/// its one-line prompt opens, with up to four images (decision 0065). Every moderator and owner tool is in the
/// management sheet, never above the composer.
struct CommunityView: View {
    let model: CommunityModel
    let social: Social

    @Environment(\.dismiss) private var dismiss
    @Environment(\.layout) private var layout
    @Environment(\.suspension) private var suspension

    @State private var reporting: Reporting?
    /// The screen has been left for a post and come back to, so the posts are asked for again.
    @State private var away = false
    /// The own post waiting for the delete to be confirmed.
    @State private var deleting: String?
    @State private var sharing: String?
    @State private var about = false
    @State private var managing = false
    @State private var composing = false
    /// The post search is open: it sits behind the top bar's search icon (decision 0080).
    @State private var searchOpen = false

    var body: some View {
        screen
            .background(BrandTokens.Colors.bg)
            .navigationTitle(Text(verbatim: model.community?.name ?? ""))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.visible, for: .navigationBar)
            .toolbar {
                if model.community != nil, model.reads {
                    ToolbarItem(placement: .topBarTrailing) {
                        RoundButton(
                            systemImage: "magnifyingglass", label: "community_search_posts",
                            fill: BrandTokens.Colors.muted, tint: BrandTokens.Colors.fg, size: 34
                        ) {
                            model.select(.discussion)
                            searchOpen.toggle()
                        }
                    }
                }
                if model.community != nil, !model.moderates {
                    ToolbarItem(placement: .topBarTrailing) {
                        RoundButton(
                            systemImage: "info.circle", label: "community_info",
                            fill: BrandTokens.Colors.muted, tint: BrandTokens.Colors.fg, size: 34
                        ) {
                            about = true
                        }
                    }
                }
            }
            .safeAreaInset(edge: .top) {
                VStack(spacing: 0) {
                    SuspendedNotice()
                    if let problem = model.problem {
                        ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if model.writes {
                    ComposePrompt(name: model.myName, photo: model.myPhoto) { composing = true }
                }
            }
            .alert(
                "post_delete_confirm",
                isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                presenting: deleting
            ) { postId in
                Button("delete", role: .destructive) { Task { await model.delete(postId) } }
                Button("cancel", role: .cancel) {}
            }
            .onChange(of: model.deleted) { _, deleted in
                if deleted { dismiss() }
            }
            .sharingPost($sharing)
            .sheet(item: $reporting) { reporting in
                ReportSheet(social: social, target: reporting.target)
            }
            .sheet(isPresented: $about) {
                CommunityInfoSheet(model: model)
            }
            .sheet(isPresented: Binding(get: { managing && layout.manage == .oneScreen }, set: { managing = $0 })) {
                CommunityManageSheet(model: model, social: social)
            }
            // Two panes need the room a sheet does not have on a wide window (decision 0087).
            .fullScreenCover(
                isPresented: Binding(get: { managing && layout.manage == .sideNav }, set: { managing = $0 })
            ) {
                CommunityManageSheet(model: model, social: social)
            }
            .sheet(isPresented: $composing) {
                ComposerSheet(model: model)
            }
            .task { await model.load() }
            .task(id: model.reads) {
                // The row of faces under the name; quiet, so a failure leaves the row out rather than a problem card.
                if model.reads { await model.loadMembers() }
            }
            .task(id: model.query) { await model.search() }
            .onAppear {
                guard away else { return }
                away = false
                Task { await model.refresh() }
            }
            .onDisappear { away = true }
    }

    /// The feed alone, or on an expanded window (decision 0087) the feed in a readable column with the aside beside
    /// it. The aside scrolls on its own, so it stays in view while the feed moves.
    @ViewBuilder private var screen: some View {
        if layout.community == .feedAndAside {
            HStack(alignment: .top, spacing: 0) {
                feed.frame(maxWidth: contentWidth)
                if let community = model.community {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            FeaturedList(posts: model.featured)
                            CommunityAside(community: community, members: model.members, limit: layout.memberPictures)
                        }
                        .padding(.vertical, 16)
                        .padding(.trailing, 16)
                    }
                    .frame(width: Self.asideWidth)
                }
            }
            .frame(maxWidth: .infinity)
        } else {
            feed
        }
    }

    /// The width of the aside on an expanded window.
    private static let asideWidth: CGFloat = 340

    private var feed: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if let community = model.community {
                    header(community)
                    if model.loaded {
                        CommunityTabRow(
                            tabs: model.tabs, selected: model.shownTab, tabsLayout: layout.tabs,
                            onSelect: { model.select($0) })
                        tabContent(community)
                    }
                } else if !model.loaded {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(16)
        }
    }

    /// What the chosen tab shows (decision 0089). The featured strip leads the discussion on a window without an aside.
    @ViewBuilder private func tabContent(_ community: Community) -> some View {
        switch model.shownTab {
        case .discussion:
            if layout.featured == .strip { FeaturedStrip(posts: model.featured) }
            if searchOpen || model.searched {
                SocialSearchField(
                    prompt: "community_search_posts",
                    text: Binding(get: { model.query }, set: { model.query = $0 }))
            }
            posts
        case .featured:
            FeaturedList(posts: model.featured)
        case .images:
            CommunityGallery(model: model)
        case .members:
            CommunityMembersTab(model: model)
        case .about:
            Panel { AboutFacts(community: community).padding(14) }
        }
    }

    /// The community as the groups readers know lay it out (decision 0080): a cover band with the picture over its
    /// edge, a large name, the audience line that opens `community_info`, a row of members, `Bjóða`, and the start of
    /// the description. The band is plain while the cover loads and when there is none.
    private func header(_ community: Community) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            CommunityHeadline(name: community.name) {
                cover(community)
            } picture: {
                CommunityBadge(community: community, size: communityPictureSize)
            } trailing: {
                if model.moderates {
                    ManageButton(count: model.manageCount) { managing = true }
                }
            }
            Button {
                about = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: community.audience == .open ? "globe" : "lock.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                        .accessibilityHidden(true)
                    Text(verbatim: audienceLineFull(community))
                        .font(TypeStyle.meta)
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                    Image(systemName: "info.circle")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 32)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("community_info"))
            if !community.description.isEmpty {
                Text(verbatim: community.description)
                    .font(.sans(14))
                    .foregroundStyle(BrandTokens.Colors.proseBody)
                    .lineLimit(Self.descriptionLines)
                if isLong(community.description) {
                    Button {
                        about = true
                    } label: {
                        Text("community_read_more")
                            .font(.sans(12.5, black: true))
                            .foregroundStyle(BrandTokens.Colors.primary)
                            .frame(minHeight: 36)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            HStack(spacing: 12) {
                MemberFaces(members: model.members, limit: layout.memberPictures)
                Spacer(minLength: 8)
                invite(community)
            }
            membership(community)
        }
    }

    /// The cover band, in the shape of the current screen's frame (decision 0086), or a plain band.
    private func cover(_ community: Community) -> some View {
        CoverBand(community: community)
    }

    /// `Bjóða`: an open community's link goes through the system share sheet. A private community's invitation has
    /// no flow in this app yet, and its link would open for nobody outside it, so there is nothing to offer there.
    @ViewBuilder private func invite(_ community: Community) -> some View {
        if community.audience == .open, let link = communityLink(community.communityId) {
            ShareLink(item: link) {
                PillLabel(text: "invite", filled: false, wide: false)
            }
        }
    }

    /// Join, ask to join, take back the request waiting, or leave; an owner does not leave the community it holds.
    @ViewBuilder private func membership(_ community: Community) -> some View {
        if community.joinRequested {
            SocialNote(text: "community_join_requested")
            Button {
                Task { await model.withdraw() }
            } label: {
                PillLabel(text: "community_withdraw_request", filled: false)
            }
            .buttonStyle(.plain)
            .disabled(model.busy)
        } else if community.role == nil, let until = model.declinedUntil {
            SocialNote(text: "community_join_declined")
            Text(verbatim: localized("community_join_again", calendarDate(until)))
                .font(TypeStyle.meta)
                .foregroundStyle(BrandTokens.Colors.mutedFg)
        } else if community.role == nil {
            Button {
                Task { await model.join() }
            } label: {
                PillLabel(text: community.audience == .open ? "community_join" : "community_request_join", filled: true)
            }
            .buttonStyle(.plain)
            .disabled(!mayWrite(suspension, !model.busy))
        } else if community.role != .owner {
            Button {
                Task { await model.leave() }
            } label: {
                PillLabel(text: "community_leave", filled: false)
            }
            .buttonStyle(.plain)
            .disabled(model.busy)
        }
        if community.role != nil {
            CommunityLevelPicker(communityId: community.communityId, social: social)
        }
        if model.muted {
            SocialNote(text: "community_muted")
        }
    }

    @ViewBuilder private var posts: some View {
        if model.loaded && model.posts.isEmpty && model.problem == nil && !model.searching {
            if model.searched {
                EmptyState(systemImage: "magnifyingglass", text: "community_search_empty")
            } else {
                EmptyState(systemImage: "text.bubble", text: "posts_empty")
            }
        }
        ForEach(model.feedPosts(aside: layout.featured == .aside), id: \.postId) { post in
            PostCard(
                post: post, linked: true, writes: model.writes,
                onReact: { emoji in Task { await model.react(post.postId, emoji) } },
                onReport: { reporting = Reporting(target: ReportTarget(kind: .post, id: post.postId)) },
                onDelete: post.mine ? { deleting = post.postId } : nil,
                onPin: model.moderates ? { Task<Void, Never> { await model.pin(post.postId, !post.pinned) } } : nil,
                onShare: { sharing = post.postId },
                onVote: { option in Task { await model.vote(post.postId, option: option) } },
                onWithdrawVote: { Task { await model.withdrawVote(post.postId) } },
                onClosePoll: model.canClose(post) ? { Task { await model.closePoll(post.postId) } } : nil)
        }
        if model.next != nil {
            Color.clear.frame(height: 1).task(id: model.next) { await model.more() }
        }
    }

    /// How much of the description the header shows before `Lesa meira` takes the reader to `community_info`
    /// (decision 0079).
    private static let descriptionLines = 3

    /// Whether `text` takes more lines than the header shows. A description over `longDescription` characters, or
    /// one with a line break in it, is the tie the apps use for the same question; every word longer than that and
    /// still cut is one tap away on `community_info`.
    private func isLong(_ text: String) -> Bool {
        text.count > Self.longDescription || text.contains("\n")
    }

    /// From which length a description is taken as one the clamp cuts.
    private static let longDescription = 140
}

/// Up to five of a community's members as overlapping faces (decision 0080): the account's photo, or the initials in
/// the fill the person's mark sets.
struct MemberFaces: View {
    let members: [CommunityMember]
    /// At most this many (5 on a phone, 12 from the expanded class: `WindowLayout.memberPictures`).
    var limit = WindowLayout.compact.memberPictures

    var body: some View {
        HStack(spacing: -8) {
            ForEach(Array(members.prefix(limit)), id: \.accountId) { member in
                Avatar(
                    name: member.name, kind: member.verified ? .verified : .unverified, size: 28,
                    photo: member.photoOf
                )
                .overlay { Circle().strokeBorder(BrandTokens.Colors.bg, lineWidth: 2) }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("community_members_stack"))
    }
}

/// The full composer, opened by the feed's prompt and closed again once the post is published or the reader
/// leaves it (decision 0079).
private struct ComposerSheet: View {
    let model: CommunityModel

    @Environment(\.dismiss) private var dismiss
    @State private var picking = false
    @State private var photos: [PhotosPickerItem] = []

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                if let problem = model.problem {
                    ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
                }
                SocialComposer(
                    placeholder: "post_compose", send: "post_publish",
                    draft: Binding(get: { model.draft }, set: { model.draft = $0 }),
                    limit: CommunityModel.postLimit, enabled: model.sendable && !model.busy,
                    onSend: {
                        Task {
                            if await model.publish() { dismiss() }
                        }
                    },
                    beginsFocused: true,
                    above: { composerImages },
                    leading: {
                        HStack(spacing: 6) {
                            RoundButton(
                                systemImage: "photo.badge.plus", label: "post_add_images",
                                fill: BrandTokens.Colors.muted, tint: BrandTokens.Colors.fg, size: 40,
                                enabled: !model.busy && !model.isPoll
                            ) {
                                if model.roomForImage() { picking = true }
                            }
                            RoundButton(
                                systemImage: "chart.bar", label: "composer_poll",
                                fill: model.isPoll ? BrandTokens.Colors.primary : BrandTokens.Colors.muted,
                                tint: model.isPoll ? BrandTokens.Colors.bg : BrandTokens.Colors.fg, size: 40,
                                enabled: !model.busy && (model.isPoll || model.images.isEmpty)
                            ) {
                                model.setPoll(!model.isPoll)
                            }
                        }
                    })
            }
            .background(BrandTokens.Colors.bg)
            .navigationTitle(Text("post_compose"))
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
            .photosPicker(
                isPresented: $picking, selection: $photos, maxSelectionCount: max(1, model.imagesLeft),
                matching: .images
            )
            .onChange(of: photos) { _, picked in
                guard !picked.isEmpty else { return }
                photos = []
                Task {
                    for item in picked { await model.pick(Picked(photo: item)) }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// The images picked for the post, and why the last one was not taken.
    @ViewBuilder private var composerImages: some View {
        if model.isPoll { PollFields(model: model) }
        if model.allowsAnonymous {
            VStack(alignment: .leading, spacing: 2) {
                Toggle(isOn: Binding(get: { model.anonymous }, set: { model.anonymous = $0 })) {
                    Text("composer_anonymous").font(.sans(14, black: true))
                }
                Text("composer_anonymous_hint")
                    .font(TypeStyle.meta)
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
        }
        if !model.images.isEmpty {
            PickedImages(paths: model.images) { path in model.unpick(path) }
        }
        if let notice = model.imageNotice {
            SocialNote(text: noticeText(notice))
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func noticeText(_ notice: CommunityModel.ImageNotice) -> LocalizedStringKey {
        switch notice {
        case .tooMany: "post_images_too_many"
        case .tooLarge: "post_image_too_large"
        case .invalid: "post_image_failed"
        }
    }
}

extension Array {
    /// The element at `index`, or nil outside the array.
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
