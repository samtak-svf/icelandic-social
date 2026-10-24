import SpjallCore
import SwiftUI

/// A community's cover in the shape the current screen gives it (decision 0086): the frame follows the width of the
/// band, 3:1 on a phone, 4:1 from 600 points and 8:3 from 840, and it changes with a rotation or a resized window.
/// Until the width is known the horizontal size class stands in.
struct CoverBand: View {
    let community: Community

    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var width: CGFloat?

    private var frame: Frame { coverFrame(width: width, compactClass: sizeClass.map { $0 == .compact }) }

    private var ratio: CGFloat {
        let size = frameSize(kind: .cover, frame: frame)
        return CGFloat(size?.w ?? 8) / CGFloat(size?.h ?? 3)
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 14)
        Color.clear
            .aspectRatio(ratio, contentMode: .fit)
            .overlay {
                LoadedPhoto(community.coverOf(frame)) { image in
                    Color.clear
                        .overlay {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFill()
                                .accessibilityLabel(Text("community_cover_alt"))
                        }
                        .clipShape(shape)
                } placeholder: {
                    shape.fill(BrandTokens.Colors.secondarySubtle).accessibilityHidden(true)
                }
            }
            .onGeometryChange(for: CGFloat.self) {
                $0.size.width
            } action: {
                width = $0
            }
    }
}
