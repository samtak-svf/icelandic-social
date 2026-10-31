import Foundation

extension PostSharing {
    /// `Deila` on a post: the forward picker, sending the post as a card into each conversation picked (decision 0080).
    @MainActor
    static func forwarding(account: Account, live: Socket) -> PostSharing {
        PostSharing { postId in
            PickModel(
                account: account, live: live,
                preview: { _ in Outgoing.post(postId) }
            ) { account, to in
                _ = try account.sharePost(postId, to: to)
            }
        }
    }
}
