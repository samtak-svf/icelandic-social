import SpjallCore
import SwiftUI

/// The words on the community's tabs (decision 0089).
func tabLabel(_ tab: CommunityModel.Tab) -> LocalizedStringKey {
    switch tab {
    case .discussion: "community_tab_discussion"
    case .featured: "community_tab_featured"
    case .images: "community_tab_images"
    case .members: "community_tab_members"
    case .about: "community_tab_about"
    }
}

/// The community's tab row (decision 0089): it scrolls sideways when the window is narrow (`WindowLayout.tabs`),
/// and lies in one row from the medium class. The chosen tab is underlined and carries the selected trait.
struct CommunityTabRow: View {
    let tabs: [CommunityModel.Tab]
    let selected: CommunityModel.Tab
    let tabsLayout: WindowLayout.Tabs
    let onSelect: (CommunityModel.Tab) -> Void

    var body: some View {
        VStack(spacing: 0) {
            switch tabsLayout {
            case .scroll:
                ScrollView(.horizontal, showsIndicators: false) { row }
            case .row:
                row
            }
            Hairline()
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("community_tabs"))
    }

    private var row: some View {
        HStack(spacing: 4) {
            ForEach(tabs, id: \.self) { tab in
                Button {
                    onSelect(tab)
                } label: {
                    Text(tabLabel(tab))
                        .font(.sans(14, black: true))
                        .foregroundStyle(tab == selected ? BrandTokens.Colors.primary : BrandTokens.Colors.mutedFg)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 44)
                        .overlay(alignment: .bottom) {
                            if tab == selected {
                                Rectangle().fill(BrandTokens.Colors.primary).frame(height: 2)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(tab == selected ? [.isButton, .isSelected] : .isButton)
            }
        }
    }
}

/// `Myndir` (decision 0089): the community's images as a grid of squares, newest first, in pages; a tap opens the
/// post an image belongs to.
struct CommunityGallery: View {
    let model: CommunityModel

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: 4)]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if model.galleryLoaded && model.gallery.isEmpty && model.problem == nil {
                EmptyState(systemImage: "photo.on.rectangle", text: "community_images_empty")
            }
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(model.gallery, id: \.mediaId) { image in
                    GalleryTile(image: image)
                }
            }
            if model.galleryNext != nil {
                Color.clear.frame(height: 1).task(id: model.galleryNext) { await model.moreGallery() }
            } else if !model.galleryLoaded {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .task { await model.loadGallery() }
    }
}

struct GalleryTile: View {
    let image: CommunityImage

    @Environment(\.postImages) private var images
    @Environment(\.displayScale) private var scale
    @State private var loaded: Image?

    var body: some View {
        NavigationLink(value: SocialRoute.post(image.postId)) {
            Color.clear
                .aspectRatio(1, contentMode: .fit)
                .background(BrandTokens.Colors.muted)
                .overlay {
                    if let loaded { loaded.resizable().scaledToFill() }
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .contentShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("post_image_alt"))
        .task(id: image.mediaId) {
            guard loaded == nil, let images else { return }
            loaded = await images.load(image.postId, image.mediaId, side: Int(240 * scale))
        }
    }
}

/// `Meðlimir` (decision 0089): the member list the community already reads, its owner and moderators first.
struct CommunityMembersTab: View {
    let model: CommunityModel

    var body: some View {
        Panel {
            VStack(alignment: .leading, spacing: 0) {
                if !model.membersLoaded {
                    ProgressView().frame(maxWidth: .infinity).padding(16)
                }
                ForEach(model.members, id: \.accountId) { member in
                    CommunityMemberRow(member: member).padding(12)
                    Hairline()
                }
            }
        }
        .task { await model.loadMembers() }
    }
}
