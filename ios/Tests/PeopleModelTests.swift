import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class PeopleModelTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)
    private lazy var live = FakeLive(account: account)

    private func model() async -> PeopleModel {
        account.met = [person("a2", "Anna"), person("a3", "Bjarni"), person("a4")]
        let model = PeopleModel(account: account, live: live, sleep: { _ in })
        await model.load()
        return model
    }

    func testListsThePeopleMet() async {
        let model = await model()
        XCTAssertTrue(model.loaded)
        XCTAssertEqual(model.people.map(\.account), ["a2", "a3", "a4"])
    }

    func testPicksInTheOrderTappedAndUnpicksOnASecondTap() async {
        let model = await model()
        model.toggle("a3")
        model.toggle("a2")
        model.toggle("a4")
        model.toggle("a2")
        XCTAssertEqual(model.picked, ["a3", "a4"])
    }

    func testOnePersonOpensTheOneToOneThereIs() async {
        account.list = [
            conversation("group", members: [person("a2"), person("a3")]),
            conversation("gone", members: [person("a2")], state: .removed),
            conversation("one", members: [person("a2")]),
        ]
        let model = await model()
        model.toggle("a2")
        await model.start()
        XCTAssertEqual(model.opened, "one")
        XCTAssertFalse(account.calls.contains { $0.hasPrefix("createConversation") })
        XCTAssertEqual(live.performed, 0)
    }

    func testOnePersonNotYetTalkedToGetsANewOneToOne() async {
        let model = await model()
        model.toggle("a2")
        await model.start()
        XCTAssertEqual(model.opened, "c1")
        XCTAssertEqual(account.calls.suffix(2), ["createConversation a2", "sync"])
        XCTAssertEqual(live.performed, 1)
    }

    func testSeveralPeopleStartAGroup() async {
        let model = await model()
        model.toggle("a3")
        model.toggle("a2")
        await model.start()
        XCTAssertEqual(account.calls.suffix(2), ["createConversation a3,a2", "sync"])
        XCTAssertEqual(model.opened, "c1")
    }

    func testAFailedStartCanBeTriedAgain() async {
        let model = await model()
        model.toggle("a2")
        account.failNext = unreachable
        await model.start()
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertNil(model.opened)

        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertEqual(model.opened, "c1")
    }

    func testAFailedLoadCanBeTriedAgain() async {
        account.met = [person("a2")]
        account.failNext = unreachable
        let model = PeopleModel(account: account, live: live, sleep: { _ in })
        await model.load()
        XCTAssertTrue(model.loaded)
        XCTAssertTrue(model.people.isEmpty)
        await model.retry()
        XCTAssertEqual(model.people.map(\.account), ["a2"])
    }

    func testListsEveryoneElseSignedInAfterThePeopleMet() async {
        account.everyone = [person("a5", "Bára"), person("a2", "Anna")]
        let model = await model()
        XCTAssertEqual(model.everyone.map(\.account), ["a5"])
    }

    func testASearchAsksTheWholeDirectory() async {
        account.everyone = [person("a5", "Bára"), person("a2", "Anna")]
        let model = await model()
        model.query = "Anna"
        await model.search()
        XCTAssertEqual(account.calls.filter { $0.hasPrefix("directory") }, ["directory - -", "directory Anna -"])
        // A search finds the people met too.
        XCTAssertEqual(model.everyone.map(\.account), ["a2"])
    }

    func testTheNextPageIsAdded() async {
        account.everyone = (1...45).map { person("p\($0)", "Manneskja \($0)") }
        let model = await model()
        XCTAssertEqual(model.directory.count, 30)
        await model.more()
        XCTAssertEqual(model.directory.count, 45)
        XCTAssertNil(model.next)
        await model.more()
        XCTAssertEqual(account.calls.filter { $0.hasPrefix("directory") }.count, 2)
    }

    func testAPickSurvivesANewSearch() async {
        account.everyone = [person("a5", "Bára")]
        let model = await model()
        model.toggle("a5")
        model.query = "Anna"
        await model.search()
        XCTAssertEqual(model.picked, ["a5"])
    }
}
