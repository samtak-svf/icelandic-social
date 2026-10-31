import Foundation
import SpjallCore
import SwiftUI

/// Where a screen leads: a community, a post, a community's report queue, the statements, a person, or, on the
/// conversations' stack alone, the people to start with and a conversation.
enum SocialRoute: Hashable {
    case community(String)
    case post(String)
    case reports(String)
    case requests(String)
    case statements
    case person(String)
    case people
    case conversation(String)

    /// The screen a link on our own host stands for (decision 0121); the core reads the link.
    init?(ownLink url: URL) {
        switch ownLink(link: url.absoluteString) {
        case .post(let id): self = .post(id)
        case .community(let id): self = .community(id)
        case nil: return nil
        }
    }
}

/// Opens a link to a screen with `open`, and leaves every other link to the system (decision 0121).
@MainActor func ownLinks(_ open: @escaping (SocialRoute) -> Void) -> OpenURLAction {
    OpenURLAction { url in
        guard let route = SocialRoute(ownLink: url) else { return .systemAction }
        open(route)
        return .handled
    }
}

/// A link the association file gave the app and no screen stands for goes on to the browser. Should the system hand
/// that same link back, it stops here rather than going round.
struct BrowserHandoff {
    private var last: URL?

    mutating func opens(_ url: URL) -> Bool {
        guard url.scheme == "https", url != last else {
            last = nil
            return false
        }
        last = url
        return true
    }
}
