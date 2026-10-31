import Foundation
import SpjallCore

@testable import Spjall

/// What the fake server holds of the home feed: the pages it answers in order (an empty `More` among them), the
/// communities the composer offers, and how many pages were asked.
struct HomeServer {
    var pages: [HomePage] = []
    var asked = 0
    var offered: [Community] = []
    var created = 0
}

/// The feed calls of `FakeSocial` (decision 0116).
extension FakeSocial {
    var feed: HomeServer {
        get { lock.withLock { _server.feed } }
        set { lock.withLock { _server.feed = newValue } }
    }

    func home(before: String?, limit: UInt32) throws -> HomePage {
        try call("home \(before ?? "-")")
        var server = feed
        defer { feed = server }
        guard server.asked < server.pages.count else { return .end(posts: []) }
        server.asked += 1
        return server.pages[server.asked - 1]
    }

    func postCommunities() throws -> [Community] {
        try call("postCommunities")
        return feed.offered
    }

    func postTo(_ target: PostTarget, body: String, media: [String], poll: [String]?) throws -> Post {
        try call("postTo \(target) \(body) media=\(media.joined(separator: ",")) poll=\(poll ?? [])")
        var server = feed
        server.created += 1
        feed = server
        switch target {
        case .wall(let audience):
            var made = makePost("h-made\(server.created)", "w-a1", body: body, author: jon)
            made.wallOwner = "a1"
            made.audience = audience
            return made
        case .community(let id, _):
            return makePost("h-made\(server.created)", id, body: body, author: jon)
        }
    }

    func uploadPostImage(for target: PostTarget, path: String) throws -> PostImage {
        let name = URL(filePath: path).lastPathComponent
        try call("uploadPostImage \(target) \(name)")
        if let refused = refuseImage { throw refused }
        return PostImage(mediaId: "m-\(name)", width: 640, height: 480)
    }
}
