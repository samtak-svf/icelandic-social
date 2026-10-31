import SpjallCore
import SwiftUI

/// The tabs, the conversations, the communities and "Ég" (decisions 0044, 0063), the notifications behind the
/// bell in the header of every screen (0109, 0111), and the screens they lead to. The communities and notifications
/// are hosted content, kept apart from the conversations (decision 0060): their screens have stacks of their own
/// and never touch the conversation store. Once per install the first launch's steps come before them (decision
/// 0043), and the Kenni offer waits for those. The socket is open while the scene is active (decision 0022). While it
/// is, what arrives is on screen, so push announces none of it (decision 0025).
struct HomeView: View {
    /// Where the reader is: a tab, or the notifications the bell opens, which are no tab (decision 0109).
    enum Tab { case conversations, communities, notifications, me }

    enum Route: Hashable {
        case people
        case conversation(String)
    }

    enum MeRoute: Hashable {
        case verify
        case link
        case statements, friends, settings
    }

    let signIn: SignInModel
    let push: PushModel
    /// The communities, their posts and the notifications, which the server hosts.
    let social: Social
    let onSignedOut: () -> Void
    /// The browser Kenni's link opens in.
    let browser: (URL) async throws -> URL?

    @State private var socket: Socket
    /// Each conversation's unsent text, kept while its screen is closed (#324).
    @State private var drafts = Drafts()
    @State private var list: ConversationsModel
    @State private var me: MeModel
    @State private var onboarding: OnboardingModel
    @State private var tab = Tab.conversations
    @State private var path: [Route] = []
    @State private var mePath: [MeRoute] = []
    @State private var communities: CommunitiesModel
    @State private var notices: NotificationsModel
    @State private var suspension: SuspensionModel
    @State private var levels: NotificationLevelsModel
    @State private var communitiesPath: [SocialRoute] = []
    @State private var noticesPath: [SocialRoute] = []
    @State private var noticesOver = NoticesOver()
    /// Kenni's offer after a sign-in, over the tabs (decision 0035).
    @State private var offering = false

    /// Profile photos for every `Avatar` under this view, decoded from the core's files and kept in memory only.
    @State private var photos: PhotoCache<UIImage>

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    /// The window's width, which decides the layout (decision 0087); unknown until the first pass.
    @State private var width: CGFloat?
    /// The models of the screens the stacks hold open, kept here so they outlive a change of container.
    @State private var routeModels = RouteModels()

    init(
        signIn: SignInModel,
        push: PushModel,
        social: Social,
        wire: Wire,
        browser: @escaping (URL) async throws -> URL?,
        onSignedOut: @escaping () -> Void
    ) {
        self.signIn = signIn
        self.browser = browser
        self.push = push
        self.social = social
        self.onSignedOut = onSignedOut
        let socket = Socket(account: signIn.account, wire: wire)
        _socket = State(initialValue: socket)
        _list = State(initialValue: ConversationsModel(account: signIn.account, live: socket))
        _me = State(initialValue: MeModel(account: signIn.account))
        _communities = State(initialValue: CommunitiesModel(social: social))
        _suspension = State(initialValue: SuspensionModel(social: social))
        _levels = State(initialValue: NotificationLevelsModel(social: social))
        _notices = State(initialValue: NotificationsModel(social: social, cancel: push.notifier.cancel))
        _onboarding = State(initialValue: OnboardingModel(notifier: push.notifier))
        _photos = State(initialValue: PhotoCache(account: signIn.account, social: social, decode: displayPhoto))
    }

    var body: some View {
        VStack(spacing: 0) {
            if onboarding.step != .done {
                // The photo is set as on "Ég", by the same model.
                OnboardingView(model: onboarding, me: me)
            } else {
                // One structure at every size class: the screens stay at the same place in the tree when the bar
                // under them becomes a rail beside them, so a stack keeps its scroll position (decision 0087).
                HStack(spacing: 0) {
                    if layout.navigation == .rail {
                        NavRail(selection: noticesOver.active(tab), select: select, items: tabItems)
                    }
                    VStack(spacing: 0) {
                        tabContent
                            .frame(maxWidth: layout.community == .feedAndAside && wide ? .infinity : contentWidth)
                            .frame(maxWidth: .infinity)
                        // Only on the roots: what they lead to has the screen to itself.
                        if layout.navigation == .bar && atRoot {
                            TabBar(selection: noticesOver.active(tab), select: select, items: tabItems)
                        }
                    }
                }
            }
        }
        .onGeometryChange(for: CGFloat.self) {
            $0.size.width
        } action: {
            width = $0
        }
        .environment(\.layout, layout)
        .tint(BrandTokens.Colors.primary)
        .environment(\.photos, photos)
        .task {
            push.live = socket
            socket.start()
            openInvite()
            openTapped()
            openTappedSocial()
            await push.start()
        }
        // The count on the bell, as the server has it.
        .task { await notices.refresh() }
        .task {
            for await _ in socket.events() { await push.quiet() }
        }
        .onChange(of: openRoutes) { routeModels.keep(openRoutes) }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                socket.start()
                // Back from the system settings the notifications notice sends to.
                Task { await push.check() }
                Task { await notices.refresh() }
            case .background: socket.stop()
            default: break
            }
            Task { await push.quiet() }
        }
        .onChange(of: push.opened) { _, conversation in
            if conversation != nil { openTapped() }
        }
        .onChange(of: push.openedSocial) { _, tap in
            if tap != nil { openTappedSocial() }
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
        // The server no longer answers this device's token: back to sign-in (decision 0057).
        .onChange(of: socket.signedOut) { _, signedOut in
            guard signedOut else { return }
            socket.stop()
            onSignedOut()
        }
        .onDisappear {
            socket.stop()
            push.live = nil
        }
    }

    /// Every route a stack holds open: the models of any other are let go.
    private var openRoutes: Set<AnyHashable> {
        Set(path.map(AnyHashable.init) + communitiesPath.map(AnyHashable.init) + noticesPath.map(AnyHashable.init))
    }

    private var layout: WindowLayout {
        layoutOf(width.map(windowClass(width:)), horizontalSizeClass: horizontalSizeClass)
    }

    private var tabItems: [TabBar<Tab>.Item] {
        [
            .init(tab: .conversations, label: localized("tab_conversations"), systemImage: "bubble.left"),
            .init(tab: .communities, label: localized("tab_communities"), systemImage: "person.3"),
            .init(tab: .me, label: localized("tab_me"), systemImage: "person"),
        ]
    }

    /// A tap on a tab. The open tab returns to its root and closes the notifications over it; another tab shows
    /// the stack it was left with (#356).
    private func select(_ target: Tab) {
        if noticesOver.reselects(target, current: tab) {
            switch target {
            case .conversations: path = []
            case .communities: communitiesPath = []
            case .me: mePath = []
            case .notifications: break
            }
            noticesPath = []
        }
        tab = target
    }

    /// The bell every full screen draws in its header (decisions 0109, 0111): the unseen count, and a tap that opens the
    /// notifications.
    private var bell: Bell {
        Bell(count: notices.unseen, selected: tab == .notifications) {
            noticesOver.open(from: tab)
            noticesPath = []
            tab = .notifications
        }
    }

    /// The selected tab's screen and the stack it leads into.
    @ViewBuilder private var tabContent: some View {
        switch tab {
        case .conversations: conversationsStack
        case .communities:
            socialStack($communitiesPath) {
                CommunitiesView(model: communities) { communitiesPath.append(.community($0)) }
            }
        case .notifications:
            socialStack($noticesPath) {
                NotificationsView(model: notices, communities: communities) { tab = noticesOver.tab }
            }
        case .me: meStack
        }
    }

    /// `Deila` on a post: the forward picker, sending the post as a card into each conversation picked (decision 0080).
    private var postSharing: PostSharing {
        let account = signIn.account
        let live = socket
        return PostSharing { postId in
            PickModel(
                account: account, live: live,
                preview: { _ in Outgoing.post(postId) }
            ) { account, to in
                _ = try account.sharePost(postId, to: to)
            }
        }
    }

    /// A shared post in a conversation: resolved through the communities' client, its image drawn from the same
    /// cache, and a tap opens the post on the communities tab (decision 0080).
    private var sharedPosts: SharedPosts {
        SharedPosts(social: social, images: PostImages(social: social)) { postId in
            communitiesPath = [.post(postId)]
            tab = .communities
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
                    let model = routeModels.model(for: route) {
                        ConversationModel(id: id, account: signIn.account, live: socket, drafts: drafts)
                    }
                    ConversationRoute(model: model)
                        .task(id: id) { await push.dismiss(id) }
                }
            }
        }
        // On the stack, not its root, so the screens pushed onto it draw the bell too (decision 0111).
        .environment(\.bell, bell)
        .environment(\.sharedPosts, sharedPosts)
    }

    private var meStack: some View {
        NavigationStack(path: $mePath) {
            OwnWall(me: me, social: social, models: routeModels, onSettings: { mePath.append(.settings) })
                .navigationDestination(for: MeRoute.self) { route in
                    switch route {
                    case .settings:
                        MeView(
                            model: me, push: push, levels: levels,
                            communityNames: communities.namesById,
                            onVerify: { mePath.append(.verify) }, onLink: { mePath.append(.link) },
                            onStatements: { mePath.append(.statements) }, onFriends: { mePath.append(.friends) },
                            onBack: { mePath.removeLast() }
                        )
                    case .link:
                        LinkView(model: LinkModel(account: signIn.account))
                    case .statements:
                        OwnStatementsView(social: social)
                    case .friends:
                        OwnFriendsView(social: social)
                    case .verify:
                        VerifyView(
                            model: signIn, onVerify: { Task { await signIn.verify(browser: browser) } },
                            onLater: { mePath.removeLast() },
                            onRetry: { Task { await signIn.retry(browser: browser) } }
                        )
                    }
                }
                .navigationDestination(for: SocialRoute.self) { route in
                    SocialDestination(route: route, social: social, models: routeModels)
                }
        }
        .hosted(bell: bell, social: social, sharing: postSharing, suspension: suspension)
    }

    /// A hosted tab's stack: its root, then communities, posts and report queues, each with a model of its own.
    private func socialStack<Root: View>(_ path: Binding<[SocialRoute]>, @ViewBuilder root: () -> Root)
        -> some View
    {
        NavigationStack(path: path) {
            root()
                .navigationDestination(for: SocialRoute.self) { route in
                    SocialDestination(route: route, social: social, models: routeModels)
                }
        }
        .hosted(bell: bell, social: social, sharing: postSharing, suspension: suspension)
    }

    /// Whether the screen on top takes the whole width on an expanded window (decision 0087): the hub, a community
    /// and its queues, as the web's wide pages. Every other screen is one column.
    private var wide: Bool {
        switch tab {
        case .communities: communitiesPath.last?.wide ?? true
        case .notifications: noticesPath.last?.wide ?? false
        case .conversations, .me: false
        }
    }

    private var atRoot: Bool {
        switch tab {
        case .conversations: path.isEmpty
        case .communities: communitiesPath.isEmpty
        case .notifications: noticesPath.isEmpty
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

    /// A tapped social notification: into its post or its community, over the notifications, or the notifications
    /// themselves when it has neither (decisions 0107, 0109, 0114).
    private func openTappedSocial() {
        guard let tap = push.takeOpenedSocial() else { return }
        noticesOver = NoticesOver()
        tab = .notifications
        noticesPath = [tap.post.map(SocialRoute.post) ?? tap.community.map(SocialRoute.community)].compactMap { $0 }
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
