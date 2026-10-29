/// The tab the notifications show over (#349). They are no tab (decision 0109): the bell opens them over the tab it
/// was pressed on, and their back returns to that tab with its stack as it was.
struct NoticesOver: Equatable {
    /// Where back goes; the conversations until the bell says otherwise, as after a tapped push.
    private(set) var tab = HomeView.Tab.conversations

    /// The bell pressed on `current`. Pressed on the notifications themselves, the tab under them stays.
    mutating func open(from current: HomeView.Tab) {
        if current != .notifications { tab = current }
    }

    /// The tab that is open: the one the notifications show over while they are open, otherwise `current`.
    func active(_ current: HomeView.Tab) -> HomeView.Tab { current == .notifications ? tab : current }

    /// Whether a tap on `target` is on the open tab, which returns to its root; another tab keeps its stack (#356).
    func reselects(_ target: HomeView.Tab, current: HomeView.Tab) -> Bool { target == active(current) }
}
