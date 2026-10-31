import Foundation
import SpjallCore

/// The wall calls of the hosted social API (decisions 0115, 0116), apart from `Social` so that file stays under its
/// cap. A wall is any account's; only this account's own can be written to.
protocol Walling: Sendable {
    /// An account's wall, also when it has no post yet. Refused with 404 when there is no such account or a block
    /// stands between them.
    func wall(_ account: String) throws -> WallProfile
    /// A page of an account's wall posts, newest first. A wall this account may not read is an empty last page.
    func wallPosts(_ account: String, before: String?, limit: UInt32) throws -> PostPage
    func wallImages(_ account: String, cursor: String?, limit: UInt32) throws -> CommunityImagePage
    /// A post on this account's own wall. Refused with 403 `suspended`.
    func createWallPost(body: String, audience: WallAudience) throws -> Post
    func setPostAudience(_ post: String, audience: WallAudience) throws
    /// Sets this account's bio; a blank one clears it.
    func setBio(_ bio: String) throws
    /// Removes a comment on this account's wall, with the reason its writer reads (1 to 500 characters).
    func removeWallComment(_ comment: String, reason: String) throws
}

extension CoreAccount {
    func wall(_ account: String) throws -> WallProfile { try core().wall(accountId: account) }

    func wallPosts(_ account: String, before: String?, limit: UInt32) throws -> PostPage {
        try core().wallPosts(accountId: account, before: before, limit: limit)
    }

    func wallImages(_ account: String, cursor: String?, limit: UInt32) throws -> CommunityImagePage {
        try core().wallImages(accountId: account, cursor: cursor, limit: limit)
    }

    func createWallPost(body: String, audience: WallAudience) throws -> Post {
        try core().createWallPost(body: body, media: [], poll: nil, audience: audience)
    }

    func setPostAudience(_ post: String, audience: WallAudience) throws {
        try core().setPostAudience(postId: post, audience: audience)
    }

    func setBio(_ bio: String) throws { try core().setBio(bio: bio) }

    func removeWallComment(_ comment: String, reason: String) throws {
        try core().removeWallComment(commentId: comment, reason: reason)
    }
}
