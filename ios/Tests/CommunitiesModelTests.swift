import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class CommunitiesModelTests: XCTestCase {
    private let social = FakeSocial()

    private func model() async -> CommunitiesModel {
        social.communities = [
            "k1": makeCommunity("k1", "Fuglar", role: .member),
            "k2": makeCommunity("k2", "Fjallgöngur"),
            "k3": makeCommunity("k3", "Fiskar", audience: .private),
        ]
        social.mine = ["k1"]
        let model = CommunitiesModel(social: social, sleep: { _ in })
        await model.load()
        return model
    }

    func testListsTheCommunitiesThisAccountIsIn() async {
        let model = await model()
        XCTAssertTrue(model.loaded)
        XCTAssertTrue(model.verified)
        XCTAssertEqual(model.mine.map(\.communityId), ["k1"])
    }

    func testASearchFindsByNameAPageAtATime() async {
        let model = await model()
        model.query = "f"
        await model.search()
        XCTAssertTrue(model.searched)
        XCTAssertEqual(model.found.map(\.name), ["Fiskar", "Fjallgöngur"])
        XCTAssertNotNil(model.next)
        await model.more()
        XCTAssertEqual(model.found.map(\.name), ["Fiskar", "Fjallgöngur", "Fuglar"])
        XCTAssertNil(model.next)
    }

    func testClearingTheSearchClearsWhatItFound() async {
        let model = await model()
        model.query = "fug"
        await model.search()
        XCTAssertEqual(model.found.count, 1)
        model.query = "  "
        await model.search()
        XCTAssertFalse(model.searched)
        XCTAssertEqual(model.found, [])
        XCTAssertFalse(model.searching)
    }

    func testAVerifiedAccountMakesACommunityAndGoesIntoIt() async {
        let model = await model()
        let made = await model.create(name: "  Bækur ", description: "Lestur", audience: .private)
        XCTAssertTrue(made)
        XCTAssertEqual(model.created, "made1")
        XCTAssertEqual(model.mine.first?.name, "Bækur")
        XCTAssertEqual(model.mine.first?.role, .owner)
        XCTAssertTrue(social.calls.contains("createCommunity Bækur"))
        model.opened()
        XCTAssertNil(model.created)
    }

    func testAnUnverifiedAccountOrABlankNameMakesNone() async {
        social.verified = false
        let model = await model()
        XCTAssertFalse(model.verified)
        let unverified = await model.create(name: "Bækur", description: "", audience: .open)
        XCTAssertFalse(unverified)
        social.verified = true
        await model.load()
        let blank = await model.create(name: "   ", description: "", audience: .open)
        XCTAssertFalse(blank)
        let long = await model.create(
            name: String(repeating: "a", count: CommunitiesModel.nameLimit + 1), description: "", audience: .open)
        XCTAssertFalse(long)
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("createCommunity") })
    }

    func testAFailedLoadShowsTheProblemAndRetries() async {
        social.failNext = unreachable
        let model = await model()
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertTrue(model.loaded)
        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertEqual(model.mine.map(\.communityId), ["k1"])
    }
}
