import SpjallCore
import SwiftUI
import XCTest

@testable import Spjall

/// The window's size class and what it lays out (decision 0087): the class comes from the core's one definition of
/// the breakpoints, and the layout is a pure function of it.
final class LayoutTests: XCTestCase {
    func testWidthsMapToTheSizeClassesThroughTheCore() {
        XCTAssertEqual(windowClass(width: 412), .compact)
        XCTAssertEqual(windowClass(width: 700), .medium)
        XCTAssertEqual(windowClass(width: 1000), .expanded)
    }

    func testTheBreakpointsAreTheCoresOwn() {
        // The edges are the core's, found through it rather than typed: the class changes exactly where it says.
        let edges = (0...2000).filter { windowClass(width: CGFloat($0)) != windowClass(width: CGFloat($0 - 1)) }
        XCTAssertEqual(edges.count, 2, "compact to medium, medium to expanded")
        for edge in edges {
            XCTAssertEqual(
                windowClass(width: CGFloat(edge)), frameForWidth(kind: .cover, widthDp: UInt32(edge)))
        }
    }

    func testAFractionalWidthJustBelowABreakpointIsStillTheClassBelow() {
        let edge = (1...2000).first { windowClass(width: CGFloat($0)) == .expanded } ?? 0
        XCTAssertEqual(windowClass(width: CGFloat(edge) - 0.5), .medium)
        XCTAssertEqual(windowClass(width: -5), .compact, "no width is never an error")
    }

    func testOnlyARegularExpandedWindowGetsTheSidebarAndTheAside() {
        let wide = layoutOf(.expanded, horizontalSizeClass: .regular)
        XCTAssertEqual(wide.navigation, .sidebar)
        XCTAssertEqual(wide.community, .feedAndAside)
        XCTAssertEqual(wide.manage, .listDetail)
        XCTAssertEqual(wide.memberPictures, 12)
    }

    func testCompactAndMediumKeepTheTabsAndOneColumn() {
        for window in [Frame.compact, .medium] {
            XCTAssertEqual(layoutOf(window, horizontalSizeClass: .regular), .compact)
        }
        XCTAssertEqual(layoutOf(.compact, horizontalSizeClass: .compact).navigation, .tabs)
        XCTAssertEqual(layoutOf(.compact, horizontalSizeClass: .compact).memberPictures, 5)
    }

    func testANarrowIPadPaneKeepsThePhoneLayoutEvenWhenTheWindowIsWide() {
        XCTAssertEqual(layoutOf(.expanded, horizontalSizeClass: .compact), .compact)
        XCTAssertEqual(layoutOf(.expanded, horizontalSizeClass: nil), .compact)
        XCTAssertEqual(layoutOf(nil, horizontalSizeClass: .regular), .compact, "until the width is known")
    }
}
