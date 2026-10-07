import SpjallCore
import SwiftUI

/// The two tabs of 1a, Samtöl and Ég, and the screens they lead to. The
/// socket is open while the scene is active (decision 0022).
struct HomeView: View {
    enum Tab { case conversations, me }

    enum Route: Hashable {
        case people
        case conversation(String)
    }

    let signIn: SignInModel
    let onSignedOut: () -> Void

    @State private var socket: Socket
    @State private var list: ConversationsModel
    @State private var me: MeModel
    @State private var tab = Tab.conversations
    @State private var path: [Route] = []

    @Environment(\.scenePhase) private var scenePhase

    init(signIn: SignInModel, wire: Wire, onSignedOut: @escaping () -> Void) {
        self.signIn = signIn
        self.onSignedOut = onSignedOut
        let socket = Socket(account: signIn.account, wire: wire)
        _socket = State(initialValue: socket)
        _list = State(initialValue: ConversationsModel(account: signIn.account, live: socket))
        _me = State(initialValue: MeModel(account: signIn.account))
    }

    var body: some View {
        TabView(selection: $tab) {
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
                    }
                }
            }
            .tabItem { Label("tab_conversations", systemImage: "bubble.left.and.bubble.right") }
            .tag(Tab.conversations)

            MeView(model: me)
                .tabItem { Label("tab_me", systemImage: "person.crop.circle") }
                .tag(Tab.me)
        }
        .tint(BrandTokens.Colors.primary)
        .task {
            socket.start()
            openInvite()
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: socket.start()
            case .background: socket.stop()
            default: break
            }
        }
        .onChange(of: signIn.signedInInvite) { _, token in
            if token != nil { openInvite() }
        }
        .onChange(of: me.signedOut) { _, signedOut in
            guard signedOut else { return }
            socket.stop()
            onSignedOut()
        }
        .onDisappear { socket.stop() }
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
