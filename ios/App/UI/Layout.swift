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

/// What a window lays out.
struct WindowLayout: Equatable, Sendable {
    /// The five places: the bar under the root screens, or a sidebar beside them.
    enum Navigation: Equatable, Sendable { case tabs, sidebar }
    /// The community page: one column, or the feed with `Um samfélagið` beside it.
    enum Community: Equatable, Sendable { case column, feedAndAside }
    /// `Stjórna`: one screen, or a list with the chosen page beside it.
    enum Manage: Equatable, Sendable { case oneScreen, listDetail }

    var navigation: Navigation
    var community: Community
    var manage: Manage
    /// How many members' pictures the community header or aside shows at most.
    var memberPictures: Int

    static let compact = WindowLayout(navigation: .tabs, community: .column, manage: .oneScreen, memberPictures: 5)
    static let expanded = WindowLayout(
        navigation: .sidebar, community: .feedAndAside, manage: .listDetail, memberPictures: 12)
}

/// The layout of a window of class `windowClass`. The two panes need a regular horizontal size class too: iPad split
/// view and Slide Over report a compact one when narrow, and keep the phone layout. Medium keeps the bottom tabs and
/// one column until its rail is built.
func layoutOf(_ windowClass: Frame?, horizontalSizeClass: UserInterfaceSizeClass?) -> WindowLayout {
    windowClass == .expanded && horizontalSizeClass == .regular ? .expanded : .compact
}

extension EnvironmentValues {
    /// The window's layout, set once at the root so a screen in a narrow pane still follows the window.
    @Entry var layout = WindowLayout.compact
}
