import Foundation
import Observation

/// What a post being written carries besides its words: the images picked for it as local copies, or a poll's
/// option fields (decision 0090), never both. A community's composer and the wall's share it (decision 0115).
@MainActor @Observable
final class PostAttachments {
    /// The poll's option fields while the post is a poll: nil for a plain post. The draft is the question.
    var pollFields: [String]?
    /// The images picked, as local copies, in their order.
    private(set) var images: [String] = []
    /// Why the last image picked or sent was not taken, until the next is picked or the post goes.
    var imageNotice: CommunityModel.ImageNotice?
    /// The media id of each picked image already uploaded, by its local copy, so a retry does not send it again.
    private var uploaded: [String: String] = [:]

    /// The post is a poll, which takes no images.
    var isPoll: Bool { pollFields != nil }

    /// Starts a poll with two empty options, or drops it. A post with images takes none.
    func setPoll(_ on: Bool) {
        if on {
            guard images.isEmpty else { return }
            pollFields = pollFields ?? Array(repeating: "", count: CommunityModel.pollMinOptions)
        } else {
            pollFields = nil
        }
    }

    func addPollOption() {
        guard let pollFields, pollFields.count < CommunityModel.pollMaxOptions else { return }
        self.pollFields = pollFields + [""]
    }

    func removePollOption(at index: Int) {
        guard var fields = pollFields, fields.count > CommunityModel.pollMinOptions, fields.indices.contains(index)
        else { return }
        fields.remove(at: index)
        pollFields = fields
    }

    /// Whether another image fits in the post; when none does, says so instead of opening the picker.
    func roomForImage() -> Bool {
        guard !isPoll else { return false }
        let room = images.count < CommunityModel.imageCount
        if !room { imageNotice = .tooMany }
        return room
    }

    /// How many more images the post takes.
    var imagesLeft: Int { max(0, CommunityModel.imageCount - images.count) }

    /// Adds the image picked to the post, as a local copy that can be shown and sent. One over 10 MB, or past
    /// the fourth, is refused with a sentence and its copy deleted.
    func pick(_ picked: Picked) async {
        guard roomForImage() else { return }
        imageNotice = nil
        switch await CommunityModel.readImage(picked) {
        case .failure(let notice):
            imageNotice = notice
        case .success(let file):
            guard images.count < CommunityModel.imageCount else {
                try? FileManager.default.removeItem(at: file)
                imageNotice = .tooMany
                return
            }
            images.append(file.path)
        }
    }

    /// Takes a picked image out of the post, and deletes its copy.
    func unpick(_ path: String) {
        images.removeAll { $0 == path }
        uploaded[path] = nil
        imageNotice = nil
        try? FileManager.default.removeItem(atPath: path)
    }

    /// The media id of each picked image, in order, uploading the ones not yet uploaded through `upload`.
    func mediaIds(_ upload: (String) async throws -> String) async throws -> [String] {
        let picked = images
        for path in picked where uploaded[path] == nil { uploaded[path] = try await upload(path) }
        return picked.compactMap { uploaded[$0] }
    }

    /// A media id the server no longer knows (over a day old): the next try uploads again.
    func forgetUploads() { uploaded = [:] }

    /// The post went: its copies are deleted and the next one starts bare.
    func finish() {
        for path in images { try? FileManager.default.removeItem(atPath: path) }
        uploaded = [:]
        images = []
        pollFields = nil
    }
}
