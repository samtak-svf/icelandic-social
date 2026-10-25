import SwiftUI

/// The side of the picture over the band's edge.
let communityPictureSize: CGFloat = 64

/// The top of a community's header (decision 0080): a band with the picture over its edge, and the large name with
/// whatever sits at the end of its row. Drawn by the community screen with the community's own band and badge, and by
/// the create screen's live preview (decision 0087) with the ones just picked, so the preview is the header's own
/// layout and not a copy of it.
struct CommunityHeadline<Band: View, Picture: View, Trailing: View>: View {
    let name: String
    @ViewBuilder let band: Band
    @ViewBuilder let picture: Picture
    @ViewBuilder let trailing: Trailing

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ZStack(alignment: .bottomLeading) {
                band
                picture
                    .overlay {
                        RoundedRectangle(cornerRadius: communityPictureSize * 0.28)
                            .strokeBorder(BrandTokens.Colors.bg, lineWidth: 3)
                    }
                    .offset(x: 16, y: 28)
            }
            .padding(.bottom, 28)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(verbatim: name)
                    .font(TypeStyle.accountName)
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                trailing
            }
        }
    }
}
