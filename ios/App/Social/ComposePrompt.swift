import SwiftUI

/// The composer's one row at the foot of a feed (decision 0080): the reader's own picture and a prompt, not a field,
/// which opens the full composer as a sheet so the feed keeps its reading width. The photo button opens the same
/// sheet, where the images are picked.
struct ComposePrompt: View {
    let name: String?
    let photo: PhotoOf?
    let action: () -> Void

    @Environment(\.suspension) private var suspension

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 10) {
                Avatar(name: name, kind: .me, size: 34, photo: photo)
                Button(action: action) {
                    Text("post_compose_prompt")
                        .font(.sans(14))
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .frame(minHeight: 40)
                        .background(
                            BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: BrandTokens.Radius.field)
                        )
                        .overlay {
                            RoundedRectangle(cornerRadius: BrandTokens.Radius.field).strokeBorder(
                                BrandTokens.Colors.border)
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                RoundButton(
                    systemImage: "photo", label: "post_add_images", fill: BrandTokens.Colors.muted,
                    tint: BrandTokens.Colors.fg, size: 34, action: action)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .disabled(!mayWrite(suspension))
        }
        .background(BrandTokens.Colors.surface)
    }
}
