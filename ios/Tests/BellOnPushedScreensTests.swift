import SpjallCore
import SwiftUI
import XCTest

@testable import Spjall

/// Decision 0111: the bell ends the top bar of a screen pushed from a tab, a conversation first of all, and a modal
/// sheet draws none. The screens are drawn for real and their top right corner is compared, with the bell and
/// without it: a corner that does not change with the bell has no bell in it.
@MainActor
final class BellOnPushedScreensTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)
    private lazy var live = FakeLive(account: account)
    private let bell = Bell(count: 3, selected: false) {}

    /// The top right corner of `screen` in a navigation stack, as PNG bytes.
    private func corner<Screen: View>(_ screen: Screen, bell: Bell?) async -> Data {
        let size = CGSize(width: 390, height: 844)
        let host = UIHostingController(rootView: NavigationStack { screen }.environment(\.bell, bell))
        let window = UIWindow(frame: CGRect(origin: .zero, size: size))
        window.rootViewController = host
        window.makeKeyAndVisible()
        try? await Task.sleep(for: .milliseconds(400))
        host.view.layoutIfNeeded()
        let area = CGRect(x: size.width - 110, y: 0, width: 110, height: 130)
        let image = UIGraphicsImageRenderer(bounds: area).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        window.isHidden = true
        return image.pngData() ?? Data()
    }

    private func conversationScreen() -> some View {
        account.list = [conversation("c1", members: [person("a2", "Anna")])]
        return ConversationView(
            model: ConversationModel(
                id: "c1", account: account, live: live, drafts: Drafts(), sleep: { _ in }, now: { FakeAccount.now }))
    }

    private func peopleScreen() -> some View {
        PeopleView(model: PeopleModel(account: account, live: live, sleep: { _ in }), onInvite: {})
    }

    /// The drawing is steady (so a difference is the bell's) and the bell changes it.
    private func assertBellShows<Screen: View>(_ screen: Screen, _ what: String) async {
        let without = await corner(screen, bell: nil)
        let again = await corner(screen, bell: nil)
        let with = await corner(screen, bell: bell)
        XCTAssertFalse(without.isEmpty, "\(what): the corner was drawn")
        XCTAssertEqual(without, again, "\(what): the corner is steady")
        XCTAssertNotEqual(without, with, "\(what): the bell is in the corner")
    }

    func testAConversationEndsItsTopBarWithTheBell() async {
        await assertBellShows(conversationScreen(), "conversation")
    }

    func testTheNewConversationPickerEndsItsNavigationBarWithTheBell() async {
        await assertBellShows(peopleScreen(), "people")
    }

    func testAModalSheetDrawsNoBell() async {
        let plain = await corner(conversationScreen(), bell: nil)
        let sheet = await corner(conversationScreen().withoutBell(), bell: bell)
        XCTAssertEqual(plain, sheet, "withoutBell() takes the bell out of what the stack provides")
    }
}
