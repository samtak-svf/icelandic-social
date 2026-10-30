import SpjallCore
import SwiftUI

// What each size class lays out (decision 0087). The window's width becomes a size class through the core's one
// definition of the breakpoints (`frameForWidth`, decision 0086), never through numbers typed here; the layout is
// then a pure function of that class and the horizontal size class, which the tests exercise. The web's
// `ui/layout.ts` is the reference.

/// The size class of a window `width` points wide: compact below 600, medium from 600, expanded from 840, as the core
/// defines them. The cover's frames carry the same three classes, so the cover frame stands for the class.
func windowClass(width: CGFloat) -> Frame {
    frameForWidth(kind: .cover, widthDp: UInt32(max(0, width.rounded(.down))))
}

/// What a window lays out: the same eight fields, with the same values for each class, as `LAYOUTS` in the web's
/// `ui/layout.ts`.
struct WindowLayout: Equatable, Sendable {
    /// The five places: a bar at the bottom of the screen, or a rail down the leading edge.
    enum Navigation: Equatable, Sendable { case bar, rail }
    /// The community page: one column, or the feed with `community_info` beside it.
    enum Community: Equatable, Sendable { case column, feedAndAside }
    /// `Stjórna`: one screen, or a side navigation with a page for each part.
    enum Manage: Equatable, Sendable { case oneScreen, sideNav }
    /// The featured posts: a strip between the composer and the feed, or in the aside (0088).
    enum Featured: Equatable, Sendable { case strip, aside }
    /// The hub: `Nýjast`, `communities_tab_mine` and `Finna` as tabs, or the communities in a column beside the feed.
    enum Hub: Equatable, Sendable { case tabs, column }
    /// `community_create`: the form alone, or the form beside a live preview of the community's header.
    enum Create: Equatable, Sendable { case form, formAndPreview }
    /// The community's tab row: it scrolls sideways when it does not fit, or lies in one row (0089).
    enum Tabs: Equatable, Sendable { case scroll, row }

    var navigation: Navigation
    var community: Community
    /// How many members' pictures the community header or aside shows at most.
    var memberPictures: Int
    var manage: Manage
    var featured: Featured
    var hub: Hub
    var create: Create
    var tabs: Tabs

    static let compact = WindowLayout(
        navigation: .bar, community: .column, memberPictures: 5, manage: .oneScreen, featured: .strip, hub: .tabs,
        create: .form, tabs: .scroll)
    static let medium = WindowLayout(
        navigation: .rail, community: .column, memberPictures: 12, manage: .oneScreen, featured: .strip, hub: .tabs,
        create: .form, tabs: .row)
    static let expanded = WindowLayout(
        navigation: .rail, community: .feedAndAside, memberPictures: 12, manage: .sideNav, featured: .aside,
        hub: .column, create: .formAndPreview, tabs: .row)
}

/// The layout of a window of class `windowClass`. Anything wider than compact needs a regular horizontal size class
/// too: iPad split view and Slide Over report a compact one when narrow and keep the phone layout, and so does a
/// window whose width is not known yet.
func layoutOf(_ windowClass: Frame?, horizontalSizeClass: UserInterfaceSizeClass?) -> WindowLayout {
    guard horizontalSizeClass == .regular, let windowClass else { return .compact }
    switch windowClass {
    // `square` is a photo's frame; a cover's width is never one.
    case .compact, .square: return .compact
    case .medium: return .medium
    case .expanded: return .expanded
    }
}

/// The widest a column of content is drawn, so a line of text stays readable: the web's `max-w-2xl` less its padding.
let contentWidth: CGFloat = 640

extension SocialRoute {
    /// Whether the screen lays out its own columns on an expanded window (decision 0087), as the web's wide pages
    /// do: a community and its queues. A post is one column.
    var wide: Bool {
        if case .post = self { false } else { true }
    }
}

extension EnvironmentValues {
    /// The window's layout, set once at the root so a screen in a narrow pane still follows the window.
    @Entry var layout = WindowLayout.compact
}
