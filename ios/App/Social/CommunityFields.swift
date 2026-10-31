import PhotosUI
import SpjallCore
import SwiftUI

/// A community's name and description, the fields the screen that makes a community and the one that changes it
/// both show (decisions 0063, 0079).
struct CommunityTextFields: View {
    @Binding var name: String
    @Binding var description: String

    var body: some View {
        TextField("community_name", text: $name)
            .onChange(of: name) { _, typed in
                if typed.count > communityNameLimit { name = String(typed.prefix(communityNameLimit)) }
            }
        TextField("community_description", text: $description, axis: .vertical)
            .lineLimit(2...6)
            .onChange(of: description) { _, typed in
                if typed.count > communityDescriptionLimit {
                    description = String(typed.prefix(communityDescriptionLimit))
                }
            }
    }
}

/// A community's picture and cover (decision 0080): choose or replace each, and take each away. The form that
/// makes a community keeps the picks until it is made; the one that changes it sends them at once. The picks
/// go through the crop sheet (decision 0086) in the caller.
struct CommunityPictureFields: View {
    let hasPicture: Bool
    let hasCover: Bool
    let onPicture: (Picked) -> Void
    let onCover: (Picked) -> Void
    let onRemovePicture: () -> Void
    let onRemoveCover: () -> Void
    /// Opens the crop sheet on the image already set (decision 0086); nil where there is no master to open it on
    /// yet, as in the form that makes a community.
    var onFramePicture: (() -> Void)?
    var onFrameCover: (() -> Void)?
    var disabled = false

    @State private var picture: PhotosPickerItem?
    @State private var cover: PhotosPickerItem?

    var body: some View {
        fields.disabled(disabled)
    }

    @ViewBuilder private var fields: some View {
        PhotosPicker(selection: $picture, matching: .images) {
            Label {
                Text("community_picture_choose")
            } icon: {
                Image(systemName: hasPicture ? "checkmark.circle.fill" : "photo")
            }
        }
        .onChange(of: picture) { _, item in
            guard let item else { return }
            picture = nil
            onPicture(Picked(photo: item))
        }
        if hasPicture {
            if let onFramePicture {
                Button(action: onFramePicture) { Text("image_frames_title") }
            }
            Button(role: .destructive, action: onRemovePicture) {
                Text("community_picture_remove")
            }
        }
        PhotosPicker(selection: $cover, matching: .images) {
            Label {
                Text("community_cover_choose")
            } icon: {
                Image(systemName: hasCover ? "checkmark.circle.fill" : "photo.on.rectangle")
            }
        }
        .onChange(of: cover) { _, item in
            guard let item else { return }
            cover = nil
            onCover(Picked(photo: item))
        }
        if hasCover {
            if let onFrameCover {
                Button(action: onFrameCover) { Text("image_frames_title") }
            }
            Button(role: .destructive, action: onRemoveCover) {
                Text("community_cover_remove")
            }
        }
    }
}

/// A community's audience, as the two rows both forms offer with what each means (decisions 0063, 0079). A private
/// community never becomes open again, so `locked` offers the private audience alone.
struct CommunityAudiencePicker: View {
    @Binding var audience: CommunityAudience
    /// The community is private already, which it stays (decision 0063).
    var locked = false

    var body: some View {
        if !locked {
            row(.open, label: "community_open", hint: "community_open_hint")
        }
        row(.private, label: "community_private", hint: "community_private_hint")
    }

    private func row(_ value: CommunityAudience, label: LocalizedStringKey, hint: LocalizedStringKey)
        -> some View
    {
        Button {
            audience = value
        } label: {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(label).font(.sans(14.5, black: true)).foregroundStyle(BrandTokens.Colors.fg)
                    Text(hint).font(.sans(13)).foregroundStyle(BrandTokens.Colors.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Image(systemName: audience == value ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(audience == value ? BrandTokens.Colors.primary : BrandTokens.Colors.mutedFg)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(audience == value ? [.isButton, .isSelected] : .isButton)
    }
}
