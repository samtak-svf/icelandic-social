import Foundation
import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class SignInModelTests: XCTestCase {
    private let account = FakeAccount()
    /// This test's own, so no state crosses between tests.
    private let defaults = UserDefaults(suiteName: "SignInModelTests.\(UUID())")!
    private var opened: [URL] = []

    /// Kenni, which redirects straight back with `callback`.
    private func kenni(_ callback: String) -> (URL) async throws -> URL? {
        { url in
            self.opened.append(url)
            return URL(string: callback)
        }
    }

    private func model() async -> SignInModel {
        let model = SignInModel(account: account, defaults: defaults)
        await model.check()
        return model
    }

    func testASignedInDeviceGoesStraightInAndTopsUpItsKeyPackages() async {
        let account = FakeAccount(signedIn: true)
        let model = SignInModel(account: account, defaults: defaults)
        await model.check()
        await model.stocking?.value
        XCTAssertEqual(model.session, .signedIn)
        XCTAssertEqual(account.calls, ["signedIn", "stockKeyPackages"])
    }

    func testAnInviteNamesTheInviterAndItsTokenGoesWithTheSignIn() async {
        account.inviters = ["t1": Inviter(accountId: "a1", name: "Anna", verified: true)]
        let model = await model()
        await model.openInvite(token: "t1")
        XCTAssertEqual(model.invite, .from(name: "Anna"))

        await model.signIn(browser: kenni("cb:1"))
        XCTAssertEqual(opened, [URL(string: FakeAccount.kenni)!])
        XCTAssertEqual(model.session, .signedIn)
        XCTAssertEqual(account.calls.filter { $0.hasPrefix("complete") }, ["completeSignIn cb:1 t1"])
    }

    func testTheOperatorsInviteHasNoName() async {
        // The operator sent it: the server names no one.
        account.inviters.updateValue(nil, forKey: "t1")
        let model = await model()
        await model.openInvite(token: "t1")
        XCTAssertEqual(model.invite, .from(name: nil))
    }

    func testADeadLinkSaysSo() async {
        let model = await model()
        await model.openInvite(token: "gone")
        XCTAssertEqual(model.invite, .expired)
    }

    func testAnUnreachableServerDoesNotMakeALinkDead() async {
        let model = await model()
        account.failNext = unreachable
        await model.openInvite(token: "t1")
        XCTAssertEqual(model.invite, .from(name: nil))
    }

    func testClosingTheBrowserIsNotAProblem() async {
        let model = await model()
        await model.signIn { _ in nil }
        XCTAssertEqual(model.session, .signedOut)
        XCTAssertNil(model.problem)
        XCTAssertFalse(model.busy)
    }

    func testAnUnreachableCompletionKeepsTheCallbackForRetry() async {
        let model = await model()
        let account = account
        await model.signIn { _ in
            // Kenni answered; the server will not.
            account.failNext = unreachable
            return URL(string: "cb:1")
        }
        XCTAssertEqual(model.session, .signedOut)
        XCTAssertEqual(model.problem, .unreachable)

        await model.retry(browser: kenni("cb:other"))
        XCTAssertEqual(model.session, .signedIn)
        XCTAssertNil(model.problem)
        XCTAssertEqual(account.calls.filter { $0 == "completeSignIn cb:1 -" }.count, 2)
        XCTAssertEqual(account.calls.filter { $0 == "beginSignIn" }.count, 1, "retry must not open Kenni again")
    }

    func testAnyOtherFailureEndsTheSignInSoRetryingStartsANewOne() async {
        let model = await model()
        let account = account
        await model.signIn { _ in
            account.failNext = CoreError.SignIn(detail: "state mismatch")
            return URL(string: "cb:1")
        }
        XCTAssertEqual(model.problem, .generic)

        await model.retry(browser: kenni("cb:2"))
        XCTAssertEqual(account.calls.filter { $0 == "beginSignIn" }.count, 2)
        XCTAssertEqual(model.session, .signedIn)
    }

    func testWithoutAnInviteANewPersonIsToldTheyNeedOne() async {
        let model = await model()
        let account = account
        await model.signIn { _ in
            account.failNext = CoreError.Refused(status: 403, code: "invite_required")
            return URL(string: "cb:1")
        }
        XCTAssertEqual(model.problem, .inviteRequired)
    }

    func testTheInviteSurvivesTheAppEnding() async {
        account.inviters = ["t1": Inviter(accountId: "a1", name: "Anna", verified: true)]
        let before = await model()
        await before.openInvite(token: "t1")

        // iOS ended the app while the person was in their authenticator.
        let after = await model()
        XCTAssertEqual(after.invite, .from(name: "Anna"))
        await after.signIn(browser: kenni("cb:1"))
        XCTAssertEqual(account.calls.filter { $0.hasPrefix("complete") }, ["completeSignIn cb:1 t1"])

        // Used, it is gone: the next sign-in carries no invite.
        let later = SignInModel(account: FakeAccount(), defaults: defaults)
        await later.check()
        XCTAssertEqual(later.invite, .none)
    }

    func testASignInBeforeTheFirstCheckIsNotUndoneByIt() async {
        let model = SignInModel(account: account, defaults: defaults)
        await model.signIn(browser: kenni("cb:1"))
        account.failNext = unreachable
        await model.check()
        XCTAssertEqual(model.session, .signedIn)
    }

    func testSigningOutStartsOverWithAFreshScreenNextTime() async {
        let model = SignInModel(account: FakeAccount(signedIn: true), defaults: defaults)
        await model.check()
        model.signedOut()
        XCTAssertEqual(model.session, .signedOut)
        XCTAssertEqual(model.invite, .none)
        await model.signIn(browser: kenni("cb:2"))
        XCTAssertEqual(model.signIns, 2)
    }

    func testAnInviteOpenedWhileSignedInWaitsForTheList() async {
        let account = FakeAccount(signedIn: true)
        let model = SignInModel(account: account, defaults: defaults)
        await model.check()
        await model.openInvite(token: "t1")
        XCTAssertEqual(model.invite, .none)
        XCTAssertFalse(account.calls.contains("resolveInvite t1"))
        XCTAssertEqual(model.takeInvite(), "t1")
        XCTAssertNil(model.signedInInvite)
    }
}
