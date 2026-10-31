import SwiftUI

/// The photo or file waiting above the field until it is sent (decision 0048): a small picture of the
/// photo, or the file's name, and a button that takes it away.
struct PendingStrip: View {
    let pending: ConversationModel.Pending
    let onRemove: () -> Void

    @Environment(\.displayScale) private var scale
    @State private var image: UIImage?

    private static let size: CGFloat = 56

    private var name: String { pending.name ?? URL(filePath: pending.path).lastPathComponent }

    var body: some View {
        HStack {
            Group {
                if pending.photo {
                    thumbnail
                } else {
                    file
                }
            }
            .accessibilityElement()
            .accessibilityLabel(
                pending.photo ? localized("attachment_pending_photo") : localized("attachment_pending_file", name))
            Spacer()
            Button(action: onRemove) {
                Image(systemName: "xmark").frame(minWidth: 44, minHeight: 44)
            }
            .foregroundStyle(BrandTokens.Colors.fg)
            .accessibilityLabel(Text("attachment_remove"))
        }
        .padding(.leading, 16)
        .padding(.top, 8)
    }

    private var thumbnail: some View {
        ZStack {
            BrandTokens.Colors.muted
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            }
        }
        .frame(width: Self.size, height: Self.size)
        .clipShape(RoundedRectangle(cornerRadius: BrandTokens.Radius.thumbnail))
        .task(id: pending.path) {
            let (path, longest) = (pending.path, Self.size * scale * 2)
            image = await Task.detached(priority: .userInitiated) { decodePhoto(path, longest: longest) }.value
        }
    }

    private var file: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc")
            Text(verbatim: name).font(.sans(14)).lineLimit(1).truncationMode(.middle)
        }
        .foregroundStyle(BrandTokens.Colors.fg)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: BrandTokens.Radius.thumbnail))
    }
}
