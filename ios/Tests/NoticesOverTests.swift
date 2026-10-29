import XCTest

@testable import Spjall

/// Back from the notifications returns to the tab the bell was pressed on (#349).
final class NoticesOverTests: XCTestCase {
    func testBackReturnsToTheTabTheBellWasPressedOn() {
        for tab in [HomeView.Tab.conversations, .communities, .me] {
            var over = NoticesOver()
            over.open(from: tab)
            XCTAssertEqual(over.tab, tab)
        }
    }

    func testTheBellOnTheNotificationsKeepsTheTabUnderThem() {
        var over = NoticesOver()
        over.open(from: .communities)
        over.open(from: .notifications)
        XCTAssertEqual(over.tab, .communities)
    }

    func testWithoutTheBellBackGoesToTheConversations() {
        XCTAssertEqual(NoticesOver().tab, .conversations, "a tapped push opens the notifications over the list")
    }
}
