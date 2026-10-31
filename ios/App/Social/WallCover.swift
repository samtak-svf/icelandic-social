import PhotosUI
import SpjallCore
import SwiftUI

/// The cover of a wall (decision 0115), in the shape the screen gives it, with a plain band while it has none. On
/// this account's own wall a menu offers what `WallModel.coverControls` allows: choosing and framing write, so a
/// suspended account is offered neither, and taking the cover away stays (decision 0116).
struct WallCover: View {
    let model: WallModel
    let own: Bool

    @State private var picking = false
    @State private var picked: [PhotosPickerItem] = []
    @State private var framing: FrameRequest?
    @State private var removing = false

    var body: some View {
        let controls = model.coverControls
        ZStack(alignment: .bottomTrailing) {
            if let wall = model.wall, wall.cover != nil {
                CoverBand(cover: wall.coverOf, alt: "wall_cover_alt")
            } else {
                RoundedRectangle(cornerRadius: 14).fill(BrandTokens.Colors.muted).frame(height: 96)
                    .accessibilityHidden(true)
            }
            if own && (controls.pick || controls.remove) { menu(controls).padding(8) }
        }
        .photosPicker(isPresented: $picking, selection: $picked, maxSelectionCount: 1, matching: .images)
        .onChange(of: picked) { _, items in
            guard let item = items.first else { return }
            picked = []
            Task { await frame(Picked(photo: item)) }
        }
        .frameSheet($framing)
        .confirmationDialog("community_cover_remove", isPresented: $removing, titleVisibility: .visible) {
            Button("community_cover_remove", role: .destructive) { Task { await model.removeCover() } }
            Button("cancel", role: .cancel) {}
        }
    }

    private func menu(_ controls: WallModel.CoverControls) -> some View {
        Menu {
            if controls.pick {
                Button("community_cover_choose") { picking = true }
            }
            if controls.reframe {
                Button("image_frames_title") { Task { await reframe() } }
            }
            if controls.remove {
                Button("community_cover_remove", role: .destructive) { removing = true }
            }
        } label: {
            Image(systemName: "photo.on.rectangle")
                .padding(10)
                .background(BrandTokens.Colors.bg, in: Circle())
                .foregroundStyle(BrandTokens.Colors.fg)
        }
        .disabled(model.busy)
        .accessibilityLabel(Text("wall_cover_alt"))
    }

    /// A new pick goes to the crop sheet first; Save uploads the master, then the framing (decision 0086).
    private func frame(_ pick: Picked) async {
        guard let master = try? await masterFile(pick) else {
            await model.setCover { try await masterFile(pick) }
            return
        }
        framing = FrameRequest(kind: .cover, master: master, start: nil) { framed in
            try? FileManager.default.removeItem(at: master)
            guard let framed else { return }
            Task { await model.setCover({ try await masterFile(pick) }, framing: framed) }
        }
    }

    /// The cover already set, framed again from the master the server kept.
    private func reframe() async {
        guard let master = await model.coverMaster() else { return }
        framing = FrameRequest(kind: .cover, master: master, start: model.coverFraming) { framed in
            try? FileManager.default.removeItem(at: master)
            guard let framed else { return }
            Task { await model.reframeCover(framed) }
        }
    }
}
