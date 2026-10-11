import Observation
import SwiftUI

extension PickModel {
    /// The picker that sends the Fljótið post `postId` into the conversations picked (decision 0040):
    /// each gets one message that carries the post's id and nothing else, never its text or author.
    /// A post comes from no conversation, so every one it can send into is offered. The post shows at the top.
    static func sharing(_ postId: String, account: Account, live: Live) -> PickModel {
        PickModel(
            account: account,
            live: live,
            preview: { account in
                // Shown as the server holds it now, as the card in the conversation will be.
                switch try account.sharedPost(postId) {
                case .found(let post): return Outgoing.post(post)
                case .gone: return Outgoing.postGone
                }
            }
        ) { account, to in
            _ = try account.sharePost(to, postId: postId)
        }
    }
}

/// "Senda í samtal" on any post below `sharingPosts`: the picker it opens, and how many it went into.
@MainActor @Observable
final class PostSharing {
    private(set) var picker: PickModel?
    /// Into how many conversations the last post went, shown for a moment.
    var shared: String?

    @ObservationIgnored private let account: Account
    @ObservationIgnored private let live: Live

    init(account: Account, live: Live) {
        self.account = account
        self.live = live
    }

    func open(_ postId: String) {
        picker = .sharing(postId, account: account, live: live)
    }

    func close() {
        picker = nil
    }

    func sent(_ count: Int) {
        picker = nil
        shared = plural("share_post_done", count)
    }
}

extension EnvironmentValues {
    /// Nil where nothing lets a post be sent into conversations.
    @Entry var postSharing: PostSharing?
}

extension View {
    /// Lets every post below send itself into conversations, and says into how many once it went.
    func sharingPosts(account: Account, live: Live) -> some View {
        modifier(SharingPosts(sharing: PostSharing(account: account, live: live)))
    }
}

private struct SharingPosts: ViewModifier {
    @State var sharing: PostSharing

    func body(content: Content) -> some View {
        content
            .environment(\.postSharing, sharing)
            .sheet(isPresented: Binding(get: { sharing.picker != nil }, set: { if !$0 { sharing.close() } })) {
                if let picker = sharing.picker {
                    PickView(model: picker, title: "share_post") { sharing.close() }
                        .onChange(of: picker.done) { _, done in
                            if let done { sharing.sent(done) }
                        }
                }
            }
            .overlay(alignment: .top) {
                if let shared = sharing.shared {
                    Text(verbatim: shared)
                        .font(.footnote)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(.regularMaterial, in: Capsule())
                        .padding(.top, 56)
                        .task {
                            AccessibilityNotification.Announcement(shared).post()
                            try? await Task.sleep(for: .seconds(2))
                            sharing.shared = nil
                        }
                }
            }
    }
}
