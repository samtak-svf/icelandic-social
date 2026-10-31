import SpjallCore
import XCTest

@testable import Spjall

/// The suggestions on the friends screen and their switch in settings (decision 0114), against the fake server.
@MainActor
final class SuggestionsTests: XCTestCase {
    private let social = FakeSocial()
    private let bera = Author(accountId: "b1", name: "Bera", verified: false)
    private let agust = Author(accountId: "b2", name: "Ágúst", verified: true)
    private let cecil = Author(accountId: "b3", name: "Cecil", verified: false)

    private func suggest(_ people: [Author]) {
        social.server.suggested = people
        for person in people { social.server.known[person.accountId] = person }
    }

    private func friends() async -> FriendsModel {
        let model = FriendsModel(social: social)
        await model.load()
        await model.suggestions.load()
        return model
    }

    func testTheSectionIsEmptyWhenTheAccountIsOut() async {
        suggest([bera])
        social.server.includedInSuggestions = false
        let model = await friends()
        XCTAssertTrue(model.loaded)
        XCTAssertTrue(model.suggestions.loaded)
        XCTAssertTrue(social.calls.contains("friendSuggestionsIncluded"))
        XCTAssertTrue(model.suggestions.people.isEmpty)
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("friendSuggestions ") })
    }

    func testAFailedReadShowsNothingAndLeavesTheLists() async {
        social.know(agust, as: .friends)
        suggest([bera])
        social.failOn = "friendSuggestionsIncluded"
        let model = await friends()
        XCTAssertEqual(model.page?.friends.map(\.person.accountId), ["b2"])
        XCTAssertTrue(social.calls.contains("friendSuggestionsIncluded"))
        XCTAssertTrue(model.suggestions.people.isEmpty)
        XCTAssertNil(model.problem)
        XCTAssertTrue(model.suggestions.loaded)
    }

    func testAFailedPageReadShowsNothingToo() async {
        suggest([bera])
        social.failOn = "friendSuggestions"
        let model = await friends()
        XCTAssertTrue(social.calls.contains("friendSuggestions -"))
        XCTAssertTrue(model.suggestions.people.isEmpty)
        XCTAssertNil(model.problem)
    }

    func testThePagesFollowNextAndStopOnNil() async {
        social.pageSize = 2
        suggest([bera, agust, cecil])
        let model = await friends()
        XCTAssertEqual(model.suggestions.people.map(\.accountId), ["b1", "b2"])
        XCTAssertEqual(model.suggestions.next, "2")
        await model.suggestions.more()
        XCTAssertTrue(social.calls.contains("friendSuggestions 2"))
        XCTAssertEqual(model.suggestions.people.map(\.accountId), ["b1", "b2", "b3"])
        XCTAssertNil(model.suggestions.next)
        let before = social.calls.count
        await model.suggestions.more()
        XCTAssertEqual(social.calls.count, before)
    }

    func testAnAskedPersonLeavesTheSectionAndAppearsAsSent() async {
        suggest([bera, agust])
        let model = await friends()
        XCTAssertEqual(model.suggestions.people.count, 2)
        await model.ask("b1")
        XCTAssertTrue(social.calls.contains("sendFriendRequest b1"))
        XCTAssertEqual(model.suggestions.people.map(\.accountId), ["b2"])
        XCTAssertEqual(model.requests.sent.map(\.person.accountId), ["b1"])
        XCTAssertNil(model.problem)
    }

    func testAFailedAskKeepsThePersonAndShowsTheProblem() async {
        suggest([bera])
        let model = await friends()
        XCTAssertEqual(model.suggestions.people.count, 1)
        social.failOn = "sendFriendRequest"
        await model.ask("b1")
        XCTAssertNotNil(model.problem)
        XCTAssertEqual(model.suggestions.people.map(\.accountId), ["b1"])
        XCTAssertTrue(model.requests.sent.isEmpty)
    }

    func testTheSwitchWritesAndReadsBack() async {
        let model = SuggestionSettingsModel(social: social)
        await model.load()
        XCTAssertEqual(model.included, true)
        await model.set(false)
        XCTAssertTrue(social.calls.contains("setFriendSuggestionsIncluded false"))
        XCTAssertEqual(social.calls.last, "friendSuggestionsIncluded")
        XCTAssertEqual(model.included, false)
        XCTAssertFalse(model.busy)
        XCTAssertNil(model.problem)
    }

    func testAFailedWriteKeepsTheServersStateAndSaysSo() async {
        let model = SuggestionSettingsModel(social: social)
        await model.load()
        XCTAssertEqual(model.included, true)
        social.failOn = "setFriendSuggestionsIncluded"
        await model.set(false)
        XCTAssertNotNil(model.problem)
        XCTAssertEqual(model.included, true)
        XCTAssertTrue(social.server.includedInSuggestions)
        XCTAssertFalse(model.busy)
    }

    func testTheSentinelWantsMoreOnlyWhenThereIsANextAndNoFailure() async {
        social.pageSize = 2
        suggest([bera, agust, cecil])
        let model = await friends()
        XCTAssertEqual(model.suggestions.next, "2")
        XCTAssertTrue(model.suggestions.wantsMore)
        await model.suggestions.more()
        XCTAssertNil(model.suggestions.next)
        XCTAssertEqual(model.suggestions.people.count, 3)
        XCTAssertFalse(model.suggestions.wantsMore)
    }

    func testAFailedPageReadStopsTheSentinelUntilLoadStartsOver() async {
        social.pageSize = 2
        suggest([bera, agust, cecil])
        let model = await friends()
        XCTAssertTrue(model.suggestions.wantsMore)
        social.failOn = "friendSuggestions"
        await model.suggestions.more()
        XCTAssertNotNil(model.suggestions.next)
        XCTAssertFalse(model.suggestions.paging)
        XCTAssertFalse(model.suggestions.wantsMore)
        XCTAssertEqual(model.suggestions.people.count, 2)
        social.failOn = nil
        await model.suggestions.load()
        XCTAssertTrue(model.suggestions.wantsMore)
    }

    func testARetryAfterAFailedAskDropsThePerson() async {
        suggest([bera])
        let model = await friends()
        XCTAssertEqual(model.suggestions.people.count, 1)
        social.failOn = "sendFriendRequest"
        await model.ask("b1")
        XCTAssertNotNil(model.problem)
        XCTAssertEqual(model.suggestions.people.count, 1)
        social.failOn = nil
        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertTrue(model.suggestions.people.isEmpty)
        XCTAssertEqual(model.requests.sent.map(\.person.accountId), ["b1"])
    }

    func testARetryAfterAFailedWriteReadsAgainWithoutWritingAndClearsTheProblem() async {
        let model = SuggestionSettingsModel(social: social)
        await model.load()
        social.failOn = "setFriendSuggestionsIncluded"
        await model.set(false)
        XCTAssertNotNil(model.problem)
        let writes = social.calls.filter { $0.hasPrefix("setFriendSuggestionsIncluded") }.count
        XCTAssertEqual(writes, 1)
        social.failOn = nil
        await model.load()
        XCTAssertNil(model.problem)
        XCTAssertEqual(model.included, true)
        XCTAssertEqual(social.calls.filter { $0.hasPrefix("setFriendSuggestionsIncluded") }.count, writes)
    }

    func testAFailedRetryKeepsTheLastKnownValueAndTheProblem() async {
        let model = SuggestionSettingsModel(social: social)
        await model.load()
        XCTAssertEqual(model.included, true)
        social.failOn = "friendSuggestionsIncluded"
        await model.load()
        XCTAssertNotNil(model.problem)
        XCTAssertEqual(model.included, true)
    }
}
