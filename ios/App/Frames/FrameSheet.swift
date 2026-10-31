import SpjallCore
import SwiftUI
import UIKit

/// A request for the crop sheet (decision 0086): the master to frame, how it was framed before, and what to do with
/// the answer. `onDone` runs once, with the framing on Save and nil on Cancel; the caller owns `master` and deletes
/// it there.
struct FrameRequest: Identifiable {
    let id = UUID()
    let kind: FrameKind
    let master: URL
    let start: Framing?
    let onDone: @MainActor (Framing?) -> Void
}

extension View {
    /// Presents the crop sheet for `request` until it is saved or cancelled.
    func frameSheet(_ request: Binding<FrameRequest?>) -> some View {
        sheet(item: request) { request in
            FrameSheet(request: request).interactiveDismissDisabled()
        }
    }
}

/// The width of the app's window in points, which the frame of the screen is chosen by (decision 0086).
@MainActor func windowWidth() -> CGFloat {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    return scene?.windows.first { $0.isKeyWindow }?.bounds.width ?? scene?.screen.bounds.width ?? 0
}

/// The master as a pick: read, made into at most 2400 pixels off the main thread, and the copy of the original
/// deleted (decision 0086).
func masterFile(_ pick: Picked) async throws -> URL {
    let copy = try await pick.read()
    defer { try? FileManager.default.removeItem(at: copy) }
    return try await offMain { try masterPhoto(copy) }
}

/// One crop sheet for a profile photo, a community picture and a cover: the shape the image has on this screen,
/// drag and pinch, Cancel and Save. For a cover, a quiet disclosure opens the frame of each screen size; it is
/// closed when the sheet opens and never a step of the default flow.
struct FrameSheet: View {
    let request: FrameRequest

    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var editor: FrameEditor?
    @State private var width: CGFloat = 0

    var body: some View {
        NavigationStack {
            ScrollView {
                if let editor, let image {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("image_frames_hint").font(.sans(13)).foregroundStyle(BrandTokens.Colors.mutedFg)
                        croppers(editor, image)
                        if !editor.advancedOpen { zoom(editor, editor.current) }
                        if editor.offersAdvanced { advanced(editor) }
                    }
                    .padding(16)
                } else {
                    ProgressView().padding(40)
                }
            }
            .onGeometryChange(for: CGFloat.self) {
                $0.size.width
            } action: {
                width = $0
            }
            .navigationTitle(Text("image_frames_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("cancel") { finish(nil) }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("save") { if let editor { finish(editor.framing()) } }.disabled(editor == nil)
                }
            }
        }
        .task { await load() }
    }

    private func finish(_ framing: Framing?) {
        request.onDone(framing)
        dismiss()
    }

    private func load() async {
        let file = request.master
        let decoded = (try? await offMain { UIImage(contentsOfFile: file.path) }) ?? nil
        guard let decoded, let pixels = decoded.cgImage else { return finish(nil) }
        image = decoded
        editor = FrameEditor(
            kind: request.kind, image: FrameMath.ImageSize(w: Double(pixels.width), h: Double(pixels.height)),
            current: frameForWidth(kind: request.kind, widthDp: UInt32(windowWidth())), base: request.start)
    }

    @ViewBuilder private func croppers(_ editor: FrameEditor, _ image: UIImage) -> some View {
        if editor.advancedOpen {
            let all = editor.shown
            let layout =
                frameForWidth(kind: .cover, widthDp: UInt32(max(width, 0))) != .compact
                ? AnyLayout(HStackLayout(alignment: .top, spacing: 12)) : AnyLayout(VStackLayout(spacing: 20))
            layout {
                ForEach(all, id: \.self) { frame in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(label(frame)).font(.sans(13, black: true)).foregroundStyle(BrandTokens.Colors.fg)
                        FrameCropper(editor: editor, frame: frame, image: image)
                        zoom(editor, frame)
                    }
                }
            }
        } else {
            FrameCropper(editor: editor, frame: editor.current, image: image)
        }
    }

    private func zoom(_ editor: FrameEditor, _ frame: Frame) -> some View {
        HStack(spacing: 12) {
            Text("image_frames_zoom").font(.sans(13)).foregroundStyle(BrandTokens.Colors.mutedFg)
            Slider(
                value: Binding(get: { editor.zoomLevel(frame) }, set: { editor.setZoomLevel(frame, $0) }),
                in: 1...FrameMath.maxZoom)
        }
        .accessibilityElement(children: .combine)
    }

    /// The link to the frame of each screen size: collapsed until asked for, and only for a cover.
    private func advanced(_ editor: FrameEditor) -> some View {
        @Bindable var editor = editor
        return VStack(alignment: .leading, spacing: 12) {
            DisclosureGroup(isExpanded: $editor.advancedOpen) {
                Button {
                    editor.resetToAutomatic()
                } label: {
                    Text("image_frames_reset").font(.sans(14, black: true))
                }
                .padding(.top, 8)
            } label: {
                Text("image_frames_advanced").font(.sans(13)).foregroundStyle(BrandTokens.Colors.mutedFg)
            }
        }
    }

    private func label(_ frame: Frame) -> LocalizedStringKey {
        switch frame {
        case .compact: "image_frames_compact"
        case .medium: "image_frames_medium"
        case .expanded, .square: "image_frames_expanded"
        }
    }
}

/// One frame of the image, shown as the rectangle the editor holds, moved by a drag and zoomed by a pinch.
struct FrameCropper: View {
    let editor: FrameEditor
    let frame: Frame
    let image: UIImage

    @State private var size = CGSize(width: 1, height: 1)
    @State private var lastTranslation = CGSize.zero
    @State private var lastMagnification = 1.0

    var body: some View {
        let rect = editor.rect(frame)
        let master = editor.image
        Color.clear
            .aspectRatio(editor.aspect(frame).ratio, contentMode: .fit)
            .overlay {
                GeometryReader { box in
                    let scale = box.size.width / (rect.w * master.w)
                    ZStack(alignment: .topLeading) {
                        Image(uiImage: image)
                            .resizable()
                            .frame(width: master.w * scale, height: master.h * scale)
                            .offset(x: -rect.x * master.w * scale, y: -rect.y * master.h * scale)
                    }
                    .frame(width: box.size.width, height: box.size.height, alignment: .topLeading)
                    .clipped()
                    .onAppear { size = box.size }
                    .onChange(of: box.size) { _, new in size = new }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: BrandTokens.Radius.card))
            .overlay(
                RoundedRectangle(cornerRadius: BrandTokens.Radius.card).strokeBorder(
                    BrandTokens.Colors.borderStrong, lineWidth: 1)
            )
            .contentShape(Rectangle())
            .gesture(drag.simultaneously(with: pinch))
            .accessibilityElement()
            .accessibilityLabel(Text("image_frames_hint"))
            .accessibilityAdjustableAction { direction in
                editor.zoom(frame, factor: direction == .increment ? 1.25 : 0.8)
            }
    }

    // The gestures give totals since they began; the editor takes the part since the last callback, so the two
    // can run at once on the same rectangle.
    private var drag: some Gesture {
        DragGesture()
            .onChanged { value in
                let step = CGSize(
                    width: value.translation.width - lastTranslation.width,
                    height: value.translation.height - lastTranslation.height)
                lastTranslation = value.translation
                editor.drag(frame, dx: step.width, dy: step.height, viewport: size)
            }
            .onEnded { _ in lastTranslation = .zero }
    }

    private var pinch: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let step = value.magnification / lastMagnification
                lastMagnification = value.magnification
                editor.zoom(frame, factor: step, anchorX: value.startAnchor.x, anchorY: value.startAnchor.y)
            }
            .onEnded { _ in lastMagnification = 1 }
    }
}
