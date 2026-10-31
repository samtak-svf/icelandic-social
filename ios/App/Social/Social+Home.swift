import Foundation
import SpjallCore

/// The home feed and the composer that posts anywhere (decision 0116), apart from `Social` so that file stays under
/// its cap.
protocol Homing: Sendable {
    /// A page of the feed, newest first. A page can be empty and still have more behind it: only `End` ends it.
    func home(before: String?, limit: UInt32) throws -> HomePage
    /// The communities this account may post in, with whether each lets a post go out without a name.
    func postCommunities() throws -> [Community]
    /// A post at the target: this account's wall, or a community.
    func postTo(_ target: PostTarget, body: String, media: [String], poll: [String]?) throws -> Post
    /// Uploads an image for a post at the target; the media id goes into `postTo`.
    func uploadPostImage(for target: PostTarget, path: String) throws -> PostImage
}

extension CoreAccount {
    func home(before: String?, limit: UInt32) throws -> HomePage { try core().home(before: before, limit: limit) }

    func postCommunities() throws -> [Community] { try core().postCommunities() }

    func postTo(_ target: PostTarget, body: String, media: [String], poll: [String]?) throws -> Post {
        try core().postTo(target: target, body: body, media: media, poll: poll)
    }

    func uploadPostImage(for target: PostTarget, path: String) throws -> PostImage {
        try core().uploadPostImageFor(target: target, path: path)
    }
}
