import SwiftUI

/// What the full-screen viewer is on: which image, and how far it is zoomed. Pure state, so paging and zooming are
/// tested without a view (#119, decision 0082).
struct ImageViewerState: Equatable {
    static let maxScale: CGFloat = 5
    /// The scale a double tap zooms to.
    static let tapScale: CGFloat = 2.5

    let count: Int
    private(set) var index: Int
    private(set) var scale: CGFloat = 1

    init(count: Int, start: Int) {
        self.count = count
        index = Self.clamp(start, count)
    }

    var isZoomed: Bool { scale > 1 }

    /// Pages to `page`, held within the images. A new page starts unzoomed; the same page keeps its zoom.
    mutating func go(to page: Int) {
        let next = Self.clamp(page, count)
        if next != index { scale = 1 }
        index = next
    }

    mutating func zoom(to scale: CGFloat) {
        self.scale = min(max(scale, 1), Self.maxScale)
    }

    /// A double tap: in when fitted, back to fitted when zoomed.
    mutating func toggleZoom() {
        zoom(to: isZoomed ? 1 : Self.tapScale)
    }

    private static func clamp(_ index: Int, _ count: Int) -> Int {
        min(max(index, 0), max(count - 1, 0))
    }
}

/// A request to open the viewer at one image: what a grid's `fullScreenCover(item:)` is driven by.
struct ImageViewerOpening: Identifiable, Equatable {
    let index: Int

    init(index: Int, count: Int) {
        self.index = min(max(index, 0), max(count - 1, 0))
    }

    var id: Int { index }
}

/// One image the viewer shows. It is independent of what the image belongs to: a post's grid and a comment's image
/// both give the viewer a list of these.
struct ViewerImage: Identifiable {
    let id: String
    /// What the image is called to VoiceOver.
    let label: Text
    /// The image decoded no larger than `side` pixels; nil when it cannot be had now.
    let load: (Int) async -> Image?
}

/// The images full screen on black: swipe between them, pinch or double tap to zoom, drag to pan while zoomed.
struct ImageViewer: View {
    let images: [ViewerImage]
    let onClose: () -> Void

    @State private var state: ImageViewerState
    @State private var pinchStart: CGFloat?
    @State private var offset: CGSize = .zero
    @State private var dragStart: CGSize?

    init(images: [ViewerImage], start: Int, onClose: @escaping () -> Void) {
        self.images = images
        self.onClose = onClose
        _state = State(initialValue: ImageViewerState(count: images.count, start: start))
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            TabView(selection: page) {
                ForEach(Array(images.enumerated()), id: \.element.id) { position, image in
                    ViewerPage(image: image)
                        .scaleEffect(position == state.index ? state.scale : 1)
                        .offset(position == state.index ? offset : .zero)
                        .tag(position)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()
            .simultaneousGesture(zoomGesture)
            .simultaneousGesture(doubleTap)
            .highPriorityGesture(panGesture, including: state.isZoomed ? .all : .subviews)
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(.black.opacity(0.5), in: Circle())
                    .frame(width: 48, height: 48)
                    .contentShape(Rectangle())
            }
            .padding(8)
            .accessibilityLabel(Text("close"))
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("image_viewer"))
        .accessibilityAction(.escape, onClose)
    }

    private var page: Binding<Int> {
        Binding(
            get: { state.index },
            set: { next in
                state.go(to: next)
                offset = .zero
            })
    }

    private var zoomGesture: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let start = pinchStart ?? state.scale
                pinchStart = start
                state.zoom(to: start * value.magnification)
                if !state.isZoomed { offset = .zero }
            }
            .onEnded { _ in pinchStart = nil }
    }

    private var doubleTap: some Gesture {
        TapGesture(count: 2).onEnded {
            withAnimation(.easeOut(duration: 0.2)) {
                state.toggleZoom()
                if !state.isZoomed { offset = .zero }
            }
        }
    }

    private var panGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                let start = dragStart ?? offset
                dragStart = start
                offset = CGSize(
                    width: start.width + value.translation.width, height: start.height + value.translation.height)
            }
            .onEnded { _ in dragStart = nil }
    }
}

/// One image fitted to the screen, loaded when it appears.
private struct ViewerPage: View {
    let image: ViewerImage

    @Environment(\.displayScale) private var scale
    @State private var loaded: Image?

    var body: some View {
        ZStack {
            if let loaded {
                loaded.resizable().scaledToFit()
            } else {
                ProgressView().tint(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(image.label)
        .accessibilityAddTraits(.isImage)
        .task(id: image.id) {
            guard loaded == nil else { return }
            loaded = await image.load(Int(1600 * scale))
        }
    }
}
