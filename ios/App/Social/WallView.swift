import SpjallCore
import SwiftUI

/// The wall under a person's header (decision 0115): the bio, the tabs and what each holds. The owner writes the
/// bio and the posts; a suspended account may still clear its bio but not write a new one or a post.
struct WallView: View {
    let model: WallModel
    let person: PersonProfile

    @Environment(\.suspension) private var suspension
    private var own: Bool { person.relation == .oneself }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }
            }
            WallCover(model: model, own: own)
            WallBio(model: model, own: own)
            WallTabRow(model: model)
            switch model.tab {
            case .posts: WallPosts(model: model, own: own)
            case .about: WallAbout(model: model, person: person)
            case .images: WallGallery(model: model)
            }
        }
        .task { await model.load() }
        .onChange(of: suspension, initial: true) { _, now in model.suspension = now }
    }
}

private struct WallBio: View {
    let model: WallModel
    let own: Bool
    @Environment(\.suspension) private var suspension

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if model.bioDraft != nil {
                TextField("wall_bio_placeholder", text: bio)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel(Text("wall_bio_label"))
                if !model.bioFits { SocialNote(text: "wall_bio_too_long") }
                HStack(spacing: 8) {
                    pill("save", filled: true) { await model.saveBio() }
                        .disabled(!model.bioFits || model.busy)
                    pill("cancel", filled: false) { model.cancelBio() }
                    if model.wall?.bio != nil {
                        pill("delete", filled: false) { await model.removeBio() }
                    }
                }
            } else if let bio = model.wall?.bio {
                Text(verbatim: bio).font(TypeStyle.bubble)
                if own { edit }
            } else if own {
                edit
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var bio: Binding<String> {
        Binding(get: { model.bioDraft ?? "" }, set: { model.bioDraft = $0 })
    }

    private func pill(_ key: LocalizedStringKey, filled: Bool, _ action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            PillLabel(text: key, filled: filled)
        }
        .buttonStyle(.plain)
    }

    private var edit: some View {
        pill("edit", filled: false) { model.editBio() }
            // Writing a bio is a write; clearing one is not (0115), and that is reached from the editor.
            .disabled(!mayWrite(suspension))
    }
}

private struct WallTabRow: View {
    let model: WallModel

    var body: some View {
        HStack(spacing: 16) {
            ForEach(WallModel.Tab.allCases, id: \.self) { tab in
                Button {
                    model.tab = tab
                } label: {
                    Text(wallTabLabel(tab))
                        .font(TypeStyle.meta)
                        .fontWeight(tab == model.tab ? .bold : .regular)
                        .foregroundStyle(tab == model.tab ? BrandTokens.Colors.fg : BrandTokens.Colors.mutedFg)
                        .padding(.vertical, 6)
                        .overlay(alignment: .bottom) {
                            if tab == model.tab { Rectangle().frame(height: 2) }
                        }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(tab == model.tab ? .isSelected : [])
            }
            Spacer(minLength: 0)
        }
    }
}

func wallTabLabel(_ tab: WallModel.Tab) -> LocalizedStringKey {
    switch tab {
    case .posts: "wall_tab_posts"
    case .about: "wall_tab_about"
    case .images: "wall_tab_images"
    }
}

private struct WallPosts: View {
    let model: WallModel
    let own: Bool
    @State private var composing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if own { composer }
            if model.postsLoaded && model.posts.isEmpty && model.problem == nil {
                EmptyState(systemImage: "text.bubble", text: "posts_empty")
            }
            ForEach(model.posts, id: \.postId) { post in
                PostCard(
                    post: post, linked: true, writes: model.writes,
                    onReact: { emoji in Task { await model.react(post.postId, emoji) } },
                    onVote: { option in Task { await model.vote(post.postId, option: option) } },
                    onWithdrawVote: { Task { await model.withdrawVote(post.postId) } },
                    onClosePoll: model.canClose(post) ? { Task { await model.closePoll(post.postId) } } : nil)
            }
            if model.next != nil {
                Color.clear.frame(height: 1).task(id: model.next) { await model.more() }
            }
        }
    }

    private var audience: Binding<WallAudience> {
        Binding(get: { model.audience }, set: { model.audience = $0 })
    }

    @ViewBuilder private var composer: some View {
        SuspendedNotice()
        Button {
            composing = true
        } label: {
            PillLabel(text: "post_compose", filled: true)
        }
        .buttonStyle(.plain)
        .disabled(!model.writes)
        .sheet(isPresented: $composing) {
            PostComposerSheet(
                draft: Binding(get: { model.draft }, set: { model.draft = $0 }),
                attachments: model.attachments, sendable: model.publishable, busy: model.busy,
                problem: model.problem, retry: { await model.retry() }, publish: { await model.publish() }
            ) {
                VStack(alignment: .leading, spacing: 8) {
                    Picker("wall_audience_label", selection: audience) {
                        Text("wall_audience_friends").tag(WallAudience.friends)
                        Text("wall_audience_everyone").tag(WallAudience.everyone)
                    }
                    .pickerStyle(.segmented)
                    SocialNote(text: "wall_not_encrypted_notice")
                }
                .padding(.horizontal, 12)
                .padding(.top, 8)
            }
        }
    }
}

private struct WallAbout: View {
    let model: WallModel
    let person: PersonProfile

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let month = model.wall?.joinedMonth {
                Text(verbatim: localized("wall_joined", Dates.month(month) ?? month)).font(TypeStyle.meta)
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
            }
            if person.relation != .oneself { PersonLinks(person: person) }
        }
    }
}

private struct WallGallery: View {
    let model: WallModel
    private let columns = [GridItem(.adaptive(minimum: 104), spacing: 4)]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if model.imagesLoaded && model.images.isEmpty && model.problem == nil {
                EmptyState(systemImage: "photo.on.rectangle", text: "community_images_empty")
            }
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(model.images, id: \.mediaId) { GalleryTile(image: $0) }
            }
            if model.imagesNext != nil {
                Color.clear.frame(height: 1).task(id: model.imagesNext) { await model.moreImages() }
            } else if !model.imagesLoaded {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .task { await model.loadImages() }
    }
}
