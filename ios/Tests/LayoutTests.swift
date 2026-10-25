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

    // The table below is the web's `LAYOUTS` in `web/src/ui/layout.ts`, field by field.

    func testCompactIsTheBarAndOneColumn() {
        let layout = layoutOf(.compact, horizontalSizeClass: .regular)
        XCTAssertEqual(layout, .compact)
        XCTAssertEqual(layout.navigation, .bar)
        XCTAssertEqual(layout.community, .column)
        XCTAssertEqual(layout.memberPictures, 5)
        XCTAssertEqual(layout.manage, .oneScreen)
        XCTAssertEqual(layout.featured, .strip)
        XCTAssertEqual(layout.hub, .tabs)
        XCTAssertEqual(layout.create, .form)
        XCTAssertEqual(layout.tabs, .scroll)
    }

    func testMediumIsARailAndOneColumn() {
        let layout = layoutOf(.medium, horizontalSizeClass: .regular)
        XCTAssertEqual(layout, .medium)
        XCTAssertEqual(layout.navigation, .rail)
        XCTAssertEqual(layout.community, .column)
        XCTAssertEqual(layout.memberPictures, 12)
        XCTAssertEqual(layout.manage, .oneScreen)
        XCTAssertEqual(layout.featured, .strip)
        XCTAssertEqual(layout.hub, .tabs)
        XCTAssertEqual(layout.create, .form)
        XCTAssertEqual(layout.tabs, .row)
    }

    func testExpandedIsARailAFeedAndAnAside() {
        let layout = layoutOf(.expanded, horizontalSizeClass: .regular)
        XCTAssertEqual(layout, .expanded)
        XCTAssertEqual(layout.navigation, .rail)
        XCTAssertEqual(layout.community, .feedAndAside)
        XCTAssertEqual(layout.memberPictures, 12)
        XCTAssertEqual(layout.manage, .sideNav)
        XCTAssertEqual(layout.featured, .aside)
        XCTAssertEqual(layout.hub, .column)
        XCTAssertEqual(layout.create, .formAndPreview)
        XCTAssertEqual(layout.tabs, .row)
    }

    func testACompactHorizontalSizeClassKeepsThePhoneLayoutAtEveryWindowClass() {
        // iPad split view and Slide Over report compact when narrow, whatever the window measures.
        for window in [Frame.compact, .medium, .expanded] {
            XCTAssertEqual(layoutOf(window, horizontalSizeClass: .compact), .compact)
            XCTAssertEqual(layoutOf(window, horizontalSizeClass: nil), .compact)
        }
        XCTAssertEqual(layoutOf(nil, horizontalSizeClass: .regular), .compact, "until the width is known")
    }

    func testACommunityAndItsQueuesAreWideAndAPostIsOneColumn() {
        // The web's wide pages (`staticData: { width: "wide" }`) among the routes the app opens.
        XCTAssertTrue(SocialRoute.community("c").wide)
        XCTAssertTrue(SocialRoute.reports("c").wide)
        XCTAssertTrue(SocialRoute.requests("c").wide)
        XCTAssertFalse(SocialRoute.post("p").wide)
    }
}
