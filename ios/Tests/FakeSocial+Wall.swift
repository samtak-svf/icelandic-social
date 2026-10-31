import Foundation
import SpjallCore

@testable import Spjall

/// What the fake server holds of walls: the bio and the posts by account, the images, and the audience of each post.
struct WallServer {
    var bios: [String: String] = [:]
    var posts: [String: [Post]] = [:]
    var images: [String: [CommunityImage]] = [:]
    var removed: [String: String] = [:]
    /// The cover version of each account that has one, and whether its master was kept.
    var covers: [String: String] = [:]
    var hasMaster = true
}

/// The wall calls of `FakeSocial` (decisions 0115, 0116).
extension FakeSocial {
    var walls: WallServer {
        get { lock.withLock { _server.walls } }
        set { lock.withLock { _server.walls = newValue } }
    }

    func wall(_ account: String) throws -> WallProfile {
        try call("wall \(account)")
        return WallProfile(
            accountId: account, wallId: "w-\(account)", bio: walls.bios[account], cover: walls.covers[account],
            coverFrames: nil, joinedMonth: "2026-03")
    }

    func wallPosts(_ account: String, before: String?, limit: UInt32) throws -> PostPage {
        try call("wallPosts \(account) \(before ?? "-")")
        let (found, next) = page(walls.posts[account] ?? [], after: before)
        return PostPage(posts: found, next: next)
    }

    func wallImages(_ account: String, cursor: String?, limit: UInt32) throws -> CommunityImagePage {
        try call("wallImages \(account) \(cursor ?? "-")")
        let (found, next) = page(walls.images[account] ?? [], after: cursor)
        return CommunityImagePage(images: found, next: next)
    }

    func createWallPost(body: String, media: [String], poll: [String]?, audience: WallAudience) throws -> Post {
        let attached = "media=\(media.joined(separator: ",")) poll=\(poll ?? [])"
        try call("createWallPost \(body) \(audience) \(attached)")
        var created = makePost("w-made\(walls.posts["a1"]?.count ?? 0)", "w-a1", body: body, author: jon)
        created.wallOwner = "a1"
        created.audience = audience
        walls.posts["a1", default: []].insert(created, at: 0)
        return created
    }

    /// `edit` for a post on a wall; not found when no wall has it.
    func editWall(_ id: String, _ change: (inout Post) throws -> Void) throws -> Post {
        for account in walls.posts.keys {
            guard let index = walls.posts[account]?.firstIndex(where: { $0.postId == id }) else { continue }
            var found = walls.posts[account]![index]
            try change(&found)
            walls.posts[account]![index] = found
            return found
        }
        throw CoreError.Refused(status: 404, code: "not_found", requestId: nil)
    }

    func uploadWallImage(path: String) throws -> PostImage {
        let name = URL(filePath: path).lastPathComponent
        try call("uploadWallImage \(name)")
        if let refused = refuseImage { throw refused }
        return PostImage(mediaId: "m-\(name)", width: 640, height: 480)
    }

    func setWallCover(path: String) throws -> String {
        try call("setWallCover")
        walls.covers["a1"] = "v1"
        return "v1"
    }

    func removeWallCover() throws {
        try call("removeWallCover")
        walls.covers["a1"] = nil
    }

    func wallCover(_ account: String, version: String) throws -> String? {
        try call("wallCover \(account) \(version)")
        return nil
    }

    func wallCoverFramed(_ account: String, version: String, frame: Frame) throws -> String? {
        try call("wallCoverFramed \(account) \(version) \(frame)")
        return nil
    }

    func setWallCoverFraming(_ framing: Framing) throws -> String {
        try call("setWallCoverFraming")
        walls.covers["a1"] = "v2"
        return "v2"
    }

    func wallCoverSource(path: String) throws -> Bool {
        try call("wallCoverSource")
        guard walls.hasMaster else { return false }
        try Data("master".utf8).write(to: URL(filePath: path))
        return true
    }

    func setPostAudience(_ post: String, audience: WallAudience) throws {
        try call("setPostAudience \(post) \(audience)")
        for account in walls.posts.keys {
            if let at = walls.posts[account]?.firstIndex(where: { $0.postId == post }) {
                walls.posts[account]?[at].audience = audience
            }
        }
    }

    func setBio(_ bio: String) throws {
        try call("setBio \(bio)")
        walls.bios["a1"] = bio.isEmpty ? nil : bio
    }

    func removeWallComment(_ comment: String, reason: String) throws {
        try call("removeWallComment \(comment) \(reason)")
        walls.removed[comment] = reason
        for post in comments.keys { comments[post]?.removeAll { $0.commentId == comment } }
    }
}
