import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// A photo from the picker, copied out of the library into a file of our own.
private struct PickedPhoto: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .image) { received in
            PickedPhoto(url: try copy(received.file))
        }
    }
}

extension Picked {
    /// A photo from `PhotosPicker`; its size is known only once it is read.
    init(photo: PhotosPickerItem) {
        let mime = photo.supportedContentTypes.lazy.compactMap(\.preferredMIMEType).first ?? "image/jpeg"
        self.init(mime: mime, size: nil) {
            guard let picked = try await photo.loadTransferable(type: PickedPhoto.self) else {
                throw CocoaError(.fileReadNoSuchFile)
            }
            return picked.url
        }
    }

    /// A file from `fileImporter`, readable only while its security scope is open.
    init(file: URL) {
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init)
        self.init(mime: mime, size: size, name: file.lastPathComponent) {
            let open = file.startAccessingSecurityScopedResource()
            defer { if open { file.stopAccessingSecurityScopedResource() } }
            return try copy(file)
        }
    }
}

/// A copy in the temporary folder, which the model deletes once the core has its own.
private func copy(_ file: URL) throws -> URL {
    let copy = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    try FileManager.default.copyItem(at: file, to: copy)
    return copy
}

/// The core keeps a file without a name ending, so the preview gets a copy
/// under the sender's name, or named after its type when there is none; the
/// folder is emptied when the preview closes.
enum PreviewCopy {
    private static var folder: URL { FileManager.default.temporaryDirectory.appending(path: "preview") }

    static func file(_ opened: ConversationModel.Opened) -> URL? {
        let fileManager = FileManager.default
        try? fileManager.removeItem(at: folder)
        // The core cut the name to a bare one (decision 0023); lastPathComponent keeps it so.
        let named = opened.name.map { URL(filePath: $0).lastPathComponent }.flatMap {
            ["", ".", "..", "/"].contains($0) ? nil : $0
        }
        var url = folder.appending(path: named ?? URL(filePath: opened.path).lastPathComponent)
        if named == nil, let ending = UTType(mimeType: opened.mime)?.preferredFilenameExtension {
            url.appendPathExtension(ending)
        }
        do {
            try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
            try fileManager.copyItem(at: URL(filePath: opened.path), to: url)
            return url
        } catch {
            return nil
        }
    }

    static func clear() {
        try? FileManager.default.removeItem(at: folder)
    }
}
