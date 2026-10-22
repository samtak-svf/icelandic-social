import PhotosUI
import SpjallCore
import SwiftUI

/// One community (decisions 0063, 0079): a compact header whose name, audience and info button lead to
/// `Um samfélagið` and, for a moderator, `Stjórna`; joining, taking a request back or leaving it; its posts,
/// newest first, searchable, this account's own with a delete. A member who is not muted writes in a sheet that
/// its one-line prompt opens, with up to four images (decision 0065). Every moderator and owner tool is in the
/// management sheet, never above the composer.
struct CommunityView: View {
    let model: CommunityModel
    let social: Social

    @Environment(\.dismiss) private var dismiss

    @State private var reporting: Reporting?
    /// The screen has been left for a post and come back to, so the posts are asked for again.
    @State private var away = false
    /// The own post waiting for the delete to be confirmed.
    @State private var deleting: String?
    @State private var about = false
    @State private var managing = false
    @State private var composing = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if let community = model.community {
                    header(community)
                    if model.reads {
                        SearchField(
                            prompt: "community_search_posts",
                            text: Binding(get: { model.query }, set: { model.query = $0 }))
                        posts
                    }
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
        .toolbar {
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
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
            }
        }
        .safeAreaInset(edge: .bottom) {
            if model.writes {
                ComposePrompt { composing = true }
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
        .environment(\.postImages, PostImages(social: social))
        .sheet(item: $reporting) { reporting in
            ReportSheet(social: social, target: reporting.target)
        }
        .sheet(isPresented: $about) {
            CommunityInfoSheet(model: model)
        }
        .sheet(isPresented: $managing) {
            CommunityManageSheet(model: model, social: social)
        }
        .sheet(isPresented: $composing) {
            ComposerSheet(model: model)
        }
        .task { await model.load() }
        .task(id: model.query) { await model.search() }
        .onAppear {
            guard away else { return }
            away = false
            Task { await model.refresh() }
        }
        .onDisappear { away = true }
    }

    /// The community's name, the line under it, and the start of its description: the way into `Um samfélagið`
    /// and, for a moderator, into `Stjórna` (decision 0079).
    private func header(_ community: Community) -> some View {
        Panel {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(verbatim: community.name)
                        .font(TypeStyle.accountName)
                        .foregroundStyle(BrandTokens.Colors.fg)
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 8)
                    if model.moderates {
                        ManageButton(count: model.manageCount) { managing = true }
                    }
                }
                Button {
                    about = true
                } label: {
                    HStack(spacing: 6) {
                        Text(verbatim: audienceLine(community))
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
                membership(community)
            }
            .padding(16)
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
            .disabled(model.busy)
        } else if community.role != .owner {
            Button {
                Task { await model.leave() }
            } label: {
                PillLabel(text: "community_leave", filled: false)
            }
            .buttonStyle(.plain)
            .disabled(model.busy)
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
        ForEach(model.posts, id: \.postId) { post in
            PostCard(
                post: post, linked: true, writes: model.writes,
                onReact: { kind in Task { await model.react(post.postId, kind) } },
                onReport: { reporting = Reporting(target: ReportTarget(kind: .post, id: post.postId)) },
                onDelete: model.mine(post.author) ? { deleting = post.postId } : nil)
        }
        if model.next != nil {
            Color.clear.frame(height: 1).task(id: model.next) { await model.more() }
        }
    }

    /// How much of the description the header shows before `Lesa meira` takes the reader to `Um samfélagið`
    /// (decision 0079).
    private static let descriptionLines = 3

    /// Whether `text` takes more lines than the header shows. A description over `longDescription` characters, or
    /// one with a line break in it, is the tie the apps use for the same question; every word longer than that and
    /// still cut is one tap away on `Um samfélagið`.
    private func isLong(_ text: String) -> Bool {
        text.count > Self.longDescription || text.contains("\n")
    }

    /// From which length a description is taken as one the clamp cuts.
    private static let longDescription = 140
}

/// The composer's one line at the foot of a feed (decision 0079): a prompt, not a field, which opens the full
/// composer as a sheet so the feed keeps its reading width.
private struct ComposePrompt: View {
    let action: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            Button(action: action) {
                Text("post_compose_prompt")
                    .font(.sans(14))
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .frame(minHeight: 40)
                    .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: 20))
                    .overlay { RoundedRectangle(cornerRadius: 20).strokeBorder(BrandTokens.Colors.border) }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .background(BrandTokens.Colors.surface)
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
                        RoundButton(
                            systemImage: "photo.badge.plus", label: "post_add_images",
                            fill: BrandTokens.Colors.muted, tint: BrandTokens.Colors.fg, size: 40,
                            enabled: !model.busy
                        ) {
                            if model.roomForImage() { picking = true }
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
