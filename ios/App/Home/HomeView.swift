import SpjallCore
import SwiftUI

/// The two tabs, the conversations and "Ég" (decision 0044), and the
/// screens they lead to. Once per install the first launch's steps come before them
/// (decision 0043), and the Kenni offer waits for those. The socket is open while the scene is active
/// (decision 0022). While it is, what arrives is on screen, so push announces
/// none of it (decision 0025).
struct HomeView: View {
    enum Tab { case conversations, me }

    enum Route: Hashable {
        case people
        case conversation(String)
    }

    enum MeRoute: Hashable {
        case verify
    }

    let signIn: SignInModel
    let push: PushModel
    let onSignedOut: () -> Void
    /// The browser Kenni's link opens in.
    let browser: (URL) async throws -> URL?

    @State private var socket: Socket
    @State private var list: ConversationsModel
    @State private var me: MeModel
    @State private var onboarding: OnboardingModel
    @State private var tab = Tab.conversations
    @State private var path: [Route] = []
    @State private var mePath: [MeRoute] = []
    /// Kenni's offer after a sign-in, over the tabs (decision 0035).
    @State private var offering = false

    /// Profile photos for every `Avatar` under this view, decoded from the core's files and kept in memory only.
    @State private var photos: PhotoCache<UIImage>

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
        _onboarding = State(initialValue: OnboardingModel(notifier: push.notifier))
        _photos = State(initialValue: PhotoCache(account: signIn.account, decode: avatarPhoto))
    }

    var body: some View {
        VStack(spacing: 0) {
            if onboarding.step != .done {
                // The photo is set as on "Ég", by the same model.
                OnboardingView(model: onboarding, me: me)
            } else {
                switch tab {
                case .conversations: conversationsStack
                case .me: meStack
                }
            }
            // Only on the two roots: what they lead to has the screen to itself.
            if onboarding.step == .done && atRoot {
                TabBar(
                    selection: $tab,
                    items: [
                        .init(tab: .conversations, label: localized("tab_conversations"), systemImage: "bubble.left"),
                        .init(tab: .me, label: localized("tab_me"), systemImage: "person"),
                    ])
            }
        }
        .tint(BrandTokens.Colors.primary)
        .environment(\.photos, photos)
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
                // Back from the system settings the notifications notice sends to.
                Task { await push.check() }
            case .background: socket.stop()
            default: break
            }
            Task { await push.quiet() }
        }
        .onChange(of: push.opened) { _, conversation in
            if conversation != nil { openTapped() }
        }
        .onChange(of: signIn.offerVerify, initial: true) { offerVerify() }
        .onChange(of: onboarding.step) { _, step in
            guard step == .done else { return }
            // The answer to the prompt, if there was one, for the notice on the list.
            Task { await push.check() }
            offerVerify()
        }
        .fullScreenCover(isPresented: $offering) {
            VerifyView(
                model: signIn,
                onVerify: { Task { await signIn.verify(browser: browser) } },
                onLater: { offering = false },
                onRetry: { Task { await signIn.retry(browser: browser) } }
            )
        }
        .onChange(of: signIn.links) {
            // Linked: back to where the offer was opened, with the shield and the registry name.
            offering = false
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

    private var conversationsStack: some View {
        NavigationStack(path: $path) {
            ConversationsView(
                model: list,
                notificationsOff: push.off,
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
            MeView(model: me, push: push, onVerify: { mePath.append(.verify) })
                .navigationDestination(for: MeRoute.self) { route in
                    switch route {
                    case .verify:
                        VerifyView(
                            model: signIn,
                            onVerify: { Task { await signIn.verify(browser: browser) } },
                            onLater: { mePath.removeLast() },
                            onRetry: { Task { await signIn.retry(browser: browser) } }
                        )
                    }
                }
        }
    }

    private var atRoot: Bool {
        switch tab {
        case .conversations: path.isEmpty
        case .me: mePath.isEmpty
        }
    }

    /// Kenni's offer after a sign-in (decision 0035), once the first launch's steps are done.
    private func offerVerify() {
        guard signIn.offerVerify, onboarding.step == .done else { return }
        offering = true
        signIn.verifyOffered()
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
