import Foundation
import SpjallCore

/// The reactions and poll actions on a post, in one place for every screen that shows posts: a community, one
/// post, a wall, the hub's feed. A model owns one and hands it, per call, how to read and write a post by id and
/// where a problem goes; the rest is shared. A reaction shows at once and goes back if the server refuses; a poll
/// action reads as the server sent it back. Neither runs twice at once on the same post.
@MainActor
final class PostActions {
    /// What a model lends for one action.
    struct Host {
        let social: Social
        /// The post as the model holds it now, or nil when it holds none by that id.
        let read: (String) -> Post?
        /// Puts the post back in the place the model holds the one with its id, if it still holds one.
        let write: (Post) -> Void
        /// This account may react or vote on the post here.
        let may: (Post) -> Bool
        /// Ends the model's old problem (`nil`, as the action starts) or gives it the new one.
        let settle: (Problem?) -> Void
    }

    private var reacting: Set<String> = []
    private var voting: Set<String> = []

    /// Sets this account's reaction on a post to `emoji`, or takes it off when it is `emoji` already.
    func react(_ postId: String, _ emoji: String, _ host: Host) async {
        guard !reacting.contains(postId), let before = host.read(postId), host.may(before) else { return }
        let off = before.myEmoji == emoji
        host.write(reacted(before, off ? nil : emoji))
        reacting.insert(postId)
        host.settle(nil)
        let social = host.social
        do {
            try await offMain {
                if off { try social.unreact(postId) } else { try social.react(postId, emoji: emoji) }
            }
            host.settle(nil)
        } catch {
            if host.read(postId) != nil { host.write(before) }
            host.settle(Problem(error))
        }
        reacting.remove(postId)
    }

    func vote(_ postId: String, option: String, _ host: Host) async {
        let social = host.social
        await pollAction(postId, host) { try social.votePoll(postId, option: option) }
    }

    func withdrawVote(_ postId: String, _ host: Host) async {
        let social = host.social
        await pollAction(postId, host) { try social.withdrawVote(postId) }
    }

    func closePoll(_ postId: String, _ host: Host) async {
        let social = host.social
        await pollAction(postId, host) { try social.closePoll(postId) }
    }

    private func pollAction(_ postId: String, _ host: Host, _ act: @escaping @Sendable () throws -> Post) async {
        guard !voting.contains(postId), let post = host.read(postId), host.may(post) else { return }
        voting.insert(postId)
        host.settle(nil)
        let outcome = await runPollAction(host.social, postId: postId, act)
        if let fresh = outcome.post, host.read(postId) != nil { host.write(fresh) }
        host.settle(outcome.problem)
        voting.remove(postId)
    }
}

extension Post {
    /// A post may be sent to a conversation. A wall post may not: its card always reads as unavailable (decision 0115).
    var canBeSent: Bool { wallOwner == nil }
}
