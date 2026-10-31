import SpjallCore
import SwiftUI

/// A community's cover in the shape the current screen gives it (decision 0086): the frame follows the width of the
/// band, 3:1 on a phone, 4:1 from 600 points and 8:3 from 840, and it changes with a rotation or a resized window.
/// Until the width is known the horizontal size class stands in.
struct CoverBand: View {
    /// The cover to draw in a frame, nil when there is none: a community's or an account's wall's.
    let cover: (Frame) -> PhotoOf?
    /// What the cover is called to a reader who cannot see it.
    var alt: LocalizedStringKey = "community_cover_alt"
    /// An image picked but not sent yet, drawn in place of the community's own cover: the create screen's preview.
    var local: UIImage?

    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var width: CGFloat?

    init(community: Community, local: UIImage? = nil) {
        self.init(cover: community.coverOf, local: local)
    }

    init(cover: @escaping (Frame) -> PhotoOf?, alt: LocalizedStringKey = "community_cover_alt", local: UIImage? = nil) {
        self.cover = cover
        self.alt = alt
        self.local = local
    }

    private var frame: Frame { coverFrame(width: width, compactClass: sizeClass.map { $0 == .compact }) }

    private var ratio: CGFloat {
        let size = frameSize(kind: .cover, frame: frame)
        return CGFloat(size?.w ?? 8) / CGFloat(size?.h ?? 3)
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: BrandTokens.Radius.card)
        Color.clear
            .aspectRatio(ratio, contentMode: .fit)
            .overlay {
                if let local {
                    Color.clear
                        .overlay { Image(uiImage: local).resizable().scaledToFill() }
                        .clipShape(shape)
                } else {
                    LoadedPhoto(cover(frame)) { image in
                        Color.clear
                            .overlay {
                                Image(uiImage: image)
                                    .resizable()
                                    .scaledToFill()
                                    .accessibilityLabel(Text(alt))
                            }
                            .clipShape(shape)
                    } placeholder: {
                        shape.fill(BrandTokens.Colors.secondarySubtle).accessibilityHidden(true)
                    }
                }
            }
            .onGeometryChange(for: CGFloat.self) {
                $0.size.width
            } action: {
                width = $0
            }
    }
}
