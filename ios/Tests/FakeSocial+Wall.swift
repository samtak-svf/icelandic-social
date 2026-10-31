import SpjallCore

@testable import Spjall

/// What the fake server holds of walls: the bio and the posts by account, the images, and the audience of each post.
struct WallServer {
    var bios: [String: String] = [:]
    var posts: [String: [Post]] = [:]
    var images: [String: [CommunityImage]] = [:]
    var removed: [String: String] = [:]
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
            accountId: account, wallId: "w-\(account)", bio: walls.bios[account], cover: nil, coverFrames: nil,
            joinedMonth: "2026-03")
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

    func createWallPost(body: String, audience: WallAudience) throws -> Post {
        try call("createWallPost \(body) \(audience)")
        var created = makePost("w-made\(walls.posts["a1"]?.count ?? 0)", "w-a1", body: body, author: jon)
        created.wallOwner = "a1"
        created.audience = audience
        walls.posts["a1", default: []].insert(created, at: 0)
        return created
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
