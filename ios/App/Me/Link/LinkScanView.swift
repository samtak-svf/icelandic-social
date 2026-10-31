import AVFoundation
import SwiftUI

/// Scanning, or pasting, the code a browser shows (decisions 0064, 0077), then approving it. The camera
/// stops at the first value that is a link code; without the camera the code can be pasted.
struct LinkView: View {
    @State private var model: LinkModel
    @State private var cameraDenied = false

    init(model: LinkModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(title: localized(title))
            content
        }
        .background(BrandTokens.Colors.bg)
        .toolbar(.hidden, for: .navigationBar)
    }

    private var title: String {
        switch model.step {
        case .approve, .sending, .done: "device_link_approve_title"
        default: "device_link_scan_title"
        }
    }

    @ViewBuilder private var content: some View {
        switch model.step {
        case .scanning:
            scanning
        case .pasting:
            pasting
        case .inspecting, .sending:
            VStack(spacing: 12) {
                ProgressView()
                if model.step == .sending, model.history != .nothing {
                    Text("device_link_sending_history").foregroundStyle(BrandTokens.Colors.mutedFg)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .approve(let request):
            LinkApproveView(model: model, request: request)
        case .done:
            Text("device_link_done")
                .font(.sans(15, black: true))
                .foregroundStyle(BrandTokens.Colors.fg)
                .padding(20)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .error(let key):
            failure(Text(LocalizedStringKey(key)))
        case .problem(let problem):
            VStack(alignment: .leading, spacing: 12) {
                ProblemCard(problem: problem) { model.restart() }
            }
            .padding(16)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    private var scanning: some View {
        VStack(spacing: 14) {
            if cameraDenied {
                Text("device_link_camera_denied")
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                LinkScanner(
                    onCode: { text in Task { await model.scanned(text) } },
                    onDenied: { cameraDenied = true }
                )
                .clipShape(RoundedRectangle(cornerRadius: BrandTokens.Radius.bubble))
                .padding(.horizontal, 16)
            }
            Text("device_link_scan_hint")
                .font(.sans(13, relativeTo: .footnote))
                .foregroundStyle(BrandTokens.Colors.mutedFg)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 20)
            Button {
                model.paste()
            } label: {
                PillLabel(text: "device_link_paste", filled: false)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
    }

    private var pasting: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("device_link_code_field", text: $model.draft, axis: .vertical)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(14)
                .background(BrandTokens.Colors.surface, in: RoundedRectangle(cornerRadius: BrandTokens.Radius.pane))
            Button {
                Task { await model.submitDraft() }
            } label: {
                PillLabel(text: "device_link_continue", filled: true)
            }
            .buttonStyle(.plain)
            Spacer()
        }
        .padding(16)
    }

    private func failure(_ message: Text) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            message.foregroundStyle(BrandTokens.Colors.fg)
            Button {
                model.restart()
            } label: {
                PillLabel(text: "try_again", filled: false)
            }
            .buttonStyle(.plain)
            Spacer()
        }
        .padding(16)
    }
}

/// The camera, reading QR codes. `onCode` gets every value read, so the model picks the first link code;
/// `onDenied` is called when the camera is not allowed or this device has none (the simulator).
private struct LinkScanner: UIViewRepresentable {
    let onCode: (String) -> Void
    let onDenied: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode, onDenied: onDenied) }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        context.coordinator.start(on: view)
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {}

    static func dismantleUIView(_ view: PreviewView, coordinator: Coordinator) {
        coordinator.stop()
    }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate, @unchecked Sendable {
        private let onCode: (String) -> Void
        private let onDenied: () -> Void
        private let session = AVCaptureSession()
        private let queue = DispatchQueue(label: "link.scan")

        init(onCode: @escaping (String) -> Void, onDenied: @escaping () -> Void) {
            self.onCode = onCode
            self.onDenied = onDenied
        }

        @MainActor func start(on view: PreviewView) {
            view.previewLayer.session = session
            view.previewLayer.videoGravity = .resizeAspectFill
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                configure()
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { granted in
                    Task { @MainActor in granted ? self.configure() : self.onDenied() }
                }
            default:
                onDenied()
            }
        }

        @MainActor private func configure() {
            guard let device = AVCaptureDevice.default(for: .video),
                let input = try? AVCaptureDeviceInput(device: device),
                session.canAddInput(input)
            else { return onDenied() }
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { return onDenied() }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
            queue.async { self.session.startRunning() }
        }

        func stop() {
            queue.async { self.session.stopRunning() }
        }

        func metadataOutput(
            _ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            for case let code as AVMetadataMachineReadableCodeObject in objects {
                if let text = code.stringValue { onCode(text) }
            }
        }
    }
}
