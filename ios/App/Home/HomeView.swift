import SpjallCore
import SwiftUI

/// The three tabs, Fljótið, the conversations and "Ég" (decision 0034), and the
/// screens they lead to. The socket is open while the scene is active
/// (decision 0022). While it is, what arrives is on screen, so push announces
/// none of it (decision 0025).
struct HomeView: View {
    enum Tab { case feed, conversations, me }

    enum Route: Hashable {
        case people
        case conversation(String)
    }

    /// Where a post leads: its replies, an author's wall, and from there a 1:1.
    enum FeedRoute: Hashable {
        case replies(String)
        case wall(String)
        case conversation(String)
    }

    enum MeRoute: Hashable {
        case settings, verify
        case replies(String)
        case wall(String)
        case conversation(String)
    }

    let signIn: SignInModel
    let push: PushModel
    let onSignedOut: () -> Void
    /// The browser Kenni's link opens in.
    let browser: (URL) async throws -> URL?

    @State private var socket: Socket
    @State private var list: ConversationsModel
    @State private var me: MeModel
    @State private var feed: PostsModel
    /// The person's own wall, made once it is known who they are.
    @State private var wall: PostsModel?
    @State private var tab = Tab.feed
    @State private var feedPath: [FeedRoute] = []
    @State private var path: [Route] = []
    @State private var mePath: [MeRoute] = []

    @Environment(\.scenePhase) private var scenePhase

    init(
        signIn: SignInModel,
        push: PushModel,
        wire: Wire,
        browser: @escaping (URL) async throws -> URL?,
        onSignedOut: @escaping () -> Void
    ) {
        self.signIn = signIn
        self.browser = browser
        self.push = push
        self.onSignedOut = onSignedOut
        let socket = Socket(account: signIn.account, wire: wire)
        _socket = State(initialValue: socket)
        _list = State(initialValue: ConversationsModel(account: signIn.account, live: socket))
        _me = State(initialValue: MeModel(account: signIn.account))
        _feed = State(initialValue: PostsModel(account: signIn.account, source: .feed))
    }

    var body: some View {
        VStack(spacing: 0) {
            switch tab {
            case .feed: feedStack
            case .conversations: conversationsStack
            case .me: meStack
            }
            // Only on the three roots: what they lead to has the screen to itself.
            if atRoot {
                TabBar(
                    selection: $tab,
                    items: [
                        .init(tab: .feed, label: localized("tab_feed"), systemImage: "water.waves"),
                        .init(tab: .conversations, label: localized("tab_conversations"), systemImage: "bubble.left"),
                        .init(tab: .me, label: localized("tab_me"), systemImage: "person"),
                    ])
            }
        }
        .tint(BrandTokens.Colors.primary)
        .task {
            push.live = socket
            socket.start()
            openInvite()
            openTapped()
            await push.start()
        }
        .task {
            for await _ in socket.events() { await push.quiet() }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                socket.start()
                if tab == .feed && feedPath.isEmpty { Task { await feed.refresh() } }
            case .background: socket.stop()
            default: break
            }
            Task { await push.quiet() }
        }
        .onChange(of: tab) { _, tab in
            // Fresh on each visit; the scroll position is not worth a stale list.
            switch tab {
            case .feed: Task { await feed.refresh() }
            case .me: Task { await wall?.refresh() }
            case .conversations: break
            }
        }
        .onChange(of: me.me?.accountId, initial: true) { _, id in
            // The wall is the person's own, so it waits until it is known who they are.
            guard let id, wall?.source != .wall(id) else { return }
            wall = PostsModel(account: signIn.account, source: .wall(id))
        }
        .onChange(of: push.opened) { _, conversation in
            if conversation != nil { openTapped() }
        }
        .onChange(of: signIn.links) {
            // Linked: back to where the offer was opened, with the shield and the registry name.
            mePath.removeAll { $0 == .verify }
            Task { await me.load() }
        }
        .onChange(of: signIn.signedInInvite) { _, token in
            if token != nil { openInvite() }
        }
        .onChange(of: me.signedOut) { _, signedOut in
            guard signedOut else { return }
            socket.stop()
            onSignedOut()
        }
        .onDisappear {
            socket.stop()
            push.live = nil
        }
    }

    private var feedStack: some View {
        NavigationStack(path: $feedPath) {
            FeedView(
                model: feed,
                onAuthor: { openWall($0) { feedPath.append(.wall($0)) } },
                onReplies: { feedPath.append(.replies($0)) }
            )
            .navigationDestination(for: FeedRoute.self) { route in
                switch route {
                case .replies(let id):
                    RepliesRoute(id: id, account: signIn.account) {
                        openWall($0) { feedPath.append(.wall($0)) }
                    }
                case .wall(let account):
                    WallRoute(
                        owner: account, account: signIn.account,
                        onReplies: { feedPath.append(.replies($0)) },
                        onOpened: { feedPath.append(.conversation($0)) })
                case .conversation(let id):
                    ConversationRoute(id: id, account: signIn.account, live: socket)
                        .task(id: id) { await push.dismiss(id) }
                }
            }
        }
    }

    private var conversationsStack: some View {
        NavigationStack(path: $path) {
            ConversationsView(
                model: list,
                onOpen: { path.append(.conversation($0)) },
                onNew: { path.append(.people) },
                onInvite: { tab = .me }
            )
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .people:
                    PeopleRoute(account: signIn.account, live: socket, onInvite: { tab = .me }) {
                        path = [.conversation($0)]
                    }
                case .conversation(let id):
                    ConversationRoute(id: id, account: signIn.account, live: socket)
                        .task(id: id) { await push.dismiss(id) }
                }
            }
        }
    }

    private var meStack: some View {
        NavigationStack(path: $mePath) {
            MeView(
                model: me, wall: wall, onSettings: { mePath.append(.settings) },
                onVerify: { mePath.append(.verify) }, onReplies: { mePath.append(.replies($0)) }
            )
            .navigationDestination(for: MeRoute.self) { route in
                switch route {
                case .settings:
                    SettingsView(model: me, push: push, onVerify: { mePath.append(.verify) })
                case .verify:
                    VerifyView(
                        model: signIn,
                        onVerify: { Task { await signIn.verify(browser: browser) } },
                        onLater: { mePath.removeLast() },
                        onRetry: { Task { await signIn.retry(browser: browser) } }
                    )
                case .replies(let id):
                    RepliesRoute(id: id, account: signIn.account) {
                        openWall($0) { mePath.append(.wall($0)) }
                    }
                case .wall(let account):
                    WallRoute(
                        owner: account, account: signIn.account,
                        onReplies: { mePath.append(.replies($0)) },
                        onOpened: { mePath.append(.conversation($0)) })
                case .conversation(let id):
                    ConversationRoute(id: id, account: signIn.account, live: socket)
                        .task(id: id) { await push.dismiss(id) }
                }
            }
        }
    }

    private var atRoot: Bool {
        switch tab {
        case .feed: feedPath.isEmpty
        case .conversations: path.isEmpty
        case .me: mePath.isEmpty
        }
    }

    /// An author's wall: the person's own is "Ég", anyone else's goes on the stack with `show`.
    private func openWall(_ person: Person, show: (String) -> Void) {
        if person.account == feed.me || person.account == me.me?.accountId {
            tab = .me
            mePath = []
        } else {
            show(person.account)
        }
    }

    /// A tapped notification: into its conversation.
    private func openTapped() {
        guard let id = push.takeOpened() else { return }
        tab = .conversations
        path = [.conversation(id)]
    }

    /// An invite link opened while signed in: into the 1:1 with whoever made it.
    private func openInvite() {
        guard let token = signIn.takeInvite() else { return }
        tab = .conversations
        Task {
            if let id = await list.openInvite(token: token) { path = [.conversation(id)] }
        }
    }
}

/// The picker, with a model of its own each time it opens.
private struct PeopleRoute: View {
    @State private var model: PeopleModel
    let onInvite: () -> Void
    let onOpened: (String) -> Void

    init(account: Account, live: Live, onInvite: @escaping () -> Void, onOpened: @escaping (String) -> Void) {
        _model = State(initialValue: PeopleModel(account: account, live: live))
        self.onInvite = onInvite
        self.onOpened = onOpened
    }

    var body: some View {
        PeopleView(model: model, onInvite: onInvite)
            .onChange(of: model.opened) { _, id in
                if let id { onOpened(id) }
            }
    }
}

/// A post's replies, with a model of their own each time they open.
private struct RepliesRoute: View {
    @State private var model: RepliesModel
    let onAuthor: (Person) -> Void

    init(id: String, account: Account, onAuthor: @escaping (Person) -> Void) {
        _model = State(initialValue: RepliesModel(account: account, postId: id))
        self.onAuthor = onAuthor
    }

    var body: some View {
        RepliesView(model: model, onAuthor: onAuthor)
    }
}

/// Another account's wall, with a model of its own each time it opens.
private struct WallRoute: View {
    @State private var model: PostsModel
    let onReplies: (String) -> Void
    let onOpened: (String) -> Void

    init(
        owner: String, account: Account, onReplies: @escaping (String) -> Void,
        onOpened: @escaping (String) -> Void
    ) {
        _model = State(initialValue: PostsModel(account: account, source: .wall(owner)))
        self.onReplies = onReplies
        self.onOpened = onOpened
    }

    var body: some View {
        WallView(model: model, onReplies: onReplies, onOpened: onOpened)
    }
}

/// A conversation, with a model of its own each time it opens.
private struct ConversationRoute: View {
    @State private var model: ConversationModel

    init(id: String, account: Account, live: Live) {
        _model = State(initialValue: ConversationModel(id: id, account: account, live: live))
    }

    var body: some View {
        ConversationView(model: model)
    }
}
