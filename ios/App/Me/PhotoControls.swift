import PhotosUI
import SpjallCore
import SwiftUI

/// Set, replace or remove the photo (decision 0039), and the one line that says who sees it: everyone
/// signed in, since it is not end-to-end encrypted. Removing asks first.
struct PhotoControls: View {
    let model: MeModel
    let hasPhoto: Bool

    /// What the photo picker chose.
    @State private var picked: PhotosPickerItem?
    @State private var removing = false
    @State private var framing: FrameRequest?

    @ViewBuilder private var pills: some View {
        PhotosPicker(selection: $picked, matching: .images) {
            PillLabel(text: hasPhoto ? "photo_change" : "photo_choose", filled: false, wide: false)
        }
        if hasPhoto {
            Button {
                Task { await reframe() }
            } label: {
                PillLabel(text: "image_frames_title", filled: false, wide: false)
            }
            Button {
                removing = true
            } label: {
                PillLabel(text: "photo_remove", filled: false, wide: false)
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Outlined pills, as the invite card's buttons are, so they read as buttons (decision 0047). Side
            // by side, and one under the other when a large font leaves no room.
            ViewThatFits {
                HStack(spacing: 8) { pills }
                VStack(alignment: .leading, spacing: 8) { pills }
            }
            .buttonStyle(.plain)
            .disabled(model.busy)
            Text("photo_seen_by_all")
                .font(.sans(12.5, relativeTo: .subheadline))
                .foregroundStyle(BrandTokens.Colors.fg)
                .padding(.horizontal, 4)
        }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            picked = nil
            let photo = Picked(photo: item)
            Task { await startFraming(photo) }
        }
        .frameSheet($framing)
        .confirmationDialog("photo_remove_confirm", isPresented: $removing, titleVisibility: .visible) {
            Button("photo_remove", role: .destructive) { Task { await model.removePhoto() } }
            Button("cancel", role: .cancel) {}
        }
    }
}

extension PhotoControls {
    /// A new pick goes to the crop sheet first; Save uploads the master, then the framing (decision 0086). The
    /// upload makes its own master from the pick, so trying again after a failure still has one.
    fileprivate func startFraming(_ photo: Picked) async {
        guard let master = try? await masterFile(photo) else {
            await model.setPhoto { try await masterFile(photo) }
            return
        }
        framing = FrameRequest(kind: .photo, master: master, start: nil) { framing in
            try? FileManager.default.removeItem(at: master)
            guard let framing else { return }
            Task { await model.setPhoto({ try await masterFile(photo) }, framing: framing) }
        }
    }

    /// The photo already set, framed again from the master the server kept.
    fileprivate func reframe() async {
        guard let found = await model.photoMaster() else { return }
        framing = FrameRequest(kind: .photo, master: found.file, start: found.framing) { framing in
            try? FileManager.default.removeItem(at: found.file)
            guard let framing else { return }
            Task { await model.reframePhoto(framing) }
        }
    }
}
