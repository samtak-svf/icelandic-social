import SpjallCore
import XCTest

@testable import Spjall

/// The models the root keeps for the open screens (decision 0087): a change of size class swaps the container, and
/// what the reader was doing in a screen must survive it.
@MainActor
final class RouteModelsTests: XCTestCase {
    private let social = FakeSocial()

    func testTheSameRouteGetsTheSameModelAndSoKeepsItsDraft() {
        let models = RouteModels()
        let route = SocialRoute.community("k1")
        let first = models.model(for: route) { CommunityModel(social: social, communityId: "k1") }
        first.draft = "Hálfskrifuð færsla"
        // The container changed, the screen was built again and asked for its model.
        let second = models.model(for: route) { CommunityModel(social: social, communityId: "k1") }
        XCTAssertTrue(first === second)
        XCTAssertEqual(second.draft, "Hálfskrifuð færsla")
    }

    func testDifferentRoutesGetDifferentModels() {
        let models = RouteModels()
        let one = models.model(for: SocialRoute.community("k1")) { CommunityModel(social: social, communityId: "k1") }
        let two = models.model(for: SocialRoute.community("k2")) { CommunityModel(social: social, communityId: "k2") }
        XCTAssertFalse(one === two)
        XCTAssertEqual(models.count, 2)
    }

    func testARouteThatLeftEveryStackStartsFreshWhenOpenedAgain() {
        let models = RouteModels()
        let route = SocialRoute.community("k1")
        let first = models.model(for: route) { CommunityModel(social: social, communityId: "k1") }
        first.draft = "Gamalt"
        models.keep([])
        XCTAssertEqual(models.count, 0)
        let again = models.model(for: route) { CommunityModel(social: social, communityId: "k1") }
        XCTAssertFalse(first === again)
        XCTAssertEqual(again.draft, "")
    }

    func testKeepLetsGoOnlyOfTheRoutesNoStackHolds() {
        let models = RouteModels()
        let open = SocialRoute.community("k1")
        let closed = SocialRoute.post("p1")
        let kept = models.model(for: open) { CommunityModel(social: social, communityId: "k1") }
        _ = models.model(for: closed) { PostModel(social: social, postId: "p1") }
        models.keep([AnyHashable(open)])
        XCTAssertEqual(models.count, 1)
        XCTAssertTrue(models.model(for: open) { CommunityModel(social: social, communityId: "x") } === kept)
    }
}
