import PhotosUI
import SpjallCore
import SwiftUI

/// One community (decision 0063): its name, audience and description, joining, taking a request back or leaving
/// it, its report queue for a moderator, and its posts, newest first, this account's own with a delete. A member
/// who is not muted writes at the foot, with up to four images (decision 0065).
struct CommunityView: View {
    let model: CommunityModel
    let social: Social

    @State private var reporting: Reporting?
    /// The screen has been left for a post and come back to, so the posts are asked for again.
    @State private var away = false
    /// The own post waiting for the delete to be confirmed.
    @State private var deleting: String?
    @State private var picking = false
    @State private var photos: [PhotosPickerItem] = []

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if let community = model.community {
                    header(community)
                    if model.reads {
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
            if model.community != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    ReportButton {
                        reporting = Reporting(target: ReportTarget(kind: .community, id: model.communityId))
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
                SocialComposer(
                    placeholder: "post_compose", send: "post_publish",
                    draft: Binding(get: { model.draft }, set: { model.draft = $0 }),
                    limit: CommunityModel.postLimit, enabled: model.sendable && !model.busy,
                    onSend: { Task { await model.publish() } },
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
        .alert(
            "post_delete_confirm",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            presenting: deleting
        ) { postId in
            Button("delete", role: .destructive) { Task { await model.delete(postId) } }
            Button("cancel", role: .cancel) {}
        }
        .environment(\.postImages, PostImages(social: social))
        .sheet(item: $reporting) { reporting in
            ReportSheet(social: social, target: reporting.target)
        }
        .task { await model.load() }
        .onAppear {
            guard away else { return }
            away = false
            Task { await model.refresh() }
        }
        .onDisappear { away = true }
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

    private func header(_ community: Community) -> some View {
        Panel {
            VStack(alignment: .leading, spacing: 10) {
                Text(verbatim: community.name)
                    .font(TypeStyle.accountName)
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: audienceLine(community))
                    .font(TypeStyle.meta)
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                if !community.description.isEmpty {
                    Text(verbatim: community.description)
                        .font(.sans(14))
                        .foregroundStyle(BrandTokens.Colors.proseBody)
                        .fixedSize(horizontal: false, vertical: true)
                }
                membership(community)
                if model.moderates {
                    NavigationLink(value: SocialRoute.reports(model.communityId)) {
                        HStack(spacing: 8) {
                            Image(systemName: "tray").accessibilityHidden(true)
                            Text("moderation_queue").font(.sans(13.5, black: true))
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold))
                                .accessibilityHidden(true)
                        }
                        .foregroundStyle(BrandTokens.Colors.primary)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
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
        if model.loaded && model.posts.isEmpty && model.problem == nil {
            EmptyState(systemImage: "text.bubble", text: "posts_empty")
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
}
