import SpjallCore
import SwiftUI

/// A pick as an image for the preview, nil when there is none or it cannot be read.
func previewImage(_ pick: Picked?) async -> UIImage? {
    guard let pick, let master = try? await masterFile(pick) else { return nil }
    defer { try? FileManager.default.removeItem(at: master) }
    return UIImage(contentsOfFile: master.path)
}

/// A key that changes when the pick does, for `.task(id:)`: `Picked` is not Equatable.
func pickKey(_ pick: Picked?) -> String {
    pick.map { "\($0.name ?? "")/\($0.size ?? 0)/\($0.mime)" } ?? ""
}

/// The community's header as it will look once made (decision 0087): the same `CommunityHeadline` the community screen
/// draws, with the name, audience line and description typed so far and the picture and cover just picked.
struct CommunityPreview: View {
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
