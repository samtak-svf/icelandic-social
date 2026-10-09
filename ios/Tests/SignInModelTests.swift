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

    /// The provider, which redirects straight back with `callback`.
    private func browser(_ callback: String) -> (URL) async throws -> URL? {
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

        await model.signIn(provider: .google, browser: browser("cb:1"))
        XCTAssertEqual(opened, [URL(string: FakeAccount.google)!])
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
        await model.signIn(provider: .google) { _ in nil }
        XCTAssertEqual(model.session, .signedOut)
        XCTAssertNil(model.problem)
        XCTAssertFalse(model.busy)
    }

    func testAnUnreachableCompletionKeepsTheCallbackForRetry() async {
        let model = await model()
        let account = account
        await model.signIn(provider: .google) { _ in
            // Google answered; the server will not.
            account.failNext = unreachable
            return URL(string: "cb:1")
        }
        XCTAssertEqual(model.session, .signedOut)
        XCTAssertEqual(model.problem, .unreachable)

        await model.retry(browser: browser("cb:other"))
        XCTAssertEqual(model.session, .signedIn)
        XCTAssertNil(model.problem)
        XCTAssertEqual(account.calls.filter { $0 == "completeSignIn cb:1 -" }.count, 2)
        XCTAssertEqual(
            account.calls.filter { $0.hasPrefix("beginSignIn") }.count, 1, "retry must not open Google again")
    }

    func testEachButtonOpensItsProvider() async {
        let model = await model()
        await model.signIn(provider: .kenni) { url in
            self.opened.append(url)
            return nil
        }
        await model.signIn(provider: .google) { url in
            self.opened.append(url)
            return nil
        }
        XCTAssertEqual(opened, [URL(string: FakeAccount.kenni)!, URL(string: FakeAccount.google)!])
        XCTAssertEqual(account.calls.filter { $0.hasPrefix("begin") }, ["beginSignIn kenni", "beginSignIn google"])
    }

    func testAnyOtherFailureEndsTheSignInSoRetryingStartsANewOneWithTheSameProvider() async {
        let model = await model()
        let account = account
        await model.signIn(provider: .kenni) { _ in
            account.failNext = CoreError.SignIn(detail: "state mismatch")
            return URL(string: "cb:1")
        }
        XCTAssertEqual(model.problem, .generic)

        await model.retry(browser: browser("cb:2"))
        XCTAssertEqual(
            account.calls.filter { $0.hasPrefix("beginSignIn") },
            ["beginSignIn kenni", "beginSignIn kenni"]
        )
        XCTAssertEqual(model.session, .signedIn)
    }

    func testSignedInTheRedirectLinksKenniInsteadOfSigningIn() async {
        let account = FakeAccount(signedIn: true)
        account.verified = false
        let model = SignInModel(account: account, defaults: defaults)
        await model.check()
        await model.verify(browser: browser("cb:k"))
        XCTAssertEqual(opened, [URL(string: FakeAccount.kenni)!])
        XCTAssertEqual(
            account.calls.filter { $0.hasPrefix("begin") || $0.hasPrefix("complete") },
            ["beginLink kenni", "completeLink cb:k"])
        XCTAssertEqual(model.links, 1)
        XCTAssertEqual(model.signIns, 1, "a link is not another sign-in")
        XCTAssertTrue(account.verified)
    }

    func testAKennitalaOnAnotherAccountIsSaidAndEndsTheLink() async {
        let account = FakeAccount(signedIn: true)
        let model = SignInModel(account: account, defaults: defaults)
        await model.check()
        await model.verify { _ in
            account.failNext = CoreError.Refused(status: 409, code: "identity_taken")
            return URL(string: "cb:k")
        }
        XCTAssertEqual(model.problem, .identityTaken)
        XCTAssertEqual(model.links, 0)

        // The link ended, so trying again opens Kenni again.
        await model.retry(browser: browser("cb:k2"))
        XCTAssertEqual(account.calls.filter { $0.hasPrefix("beginLink") }.count, 2)
        XCTAssertEqual(model.links, 1)
    }

    func testAnUnreachableLinkKeepsTheCallbackForRetry() async {
        let account = FakeAccount(signedIn: true)
        let model = SignInModel(account: account, defaults: defaults)
        await model.check()
        await model.verify { _ in
            account.failNext = unreachable
            return URL(string: "cb:k")
        }
        XCTAssertEqual(model.problem, .unreachable)
        await model.retry(browser: browser("cb:other"))
        XCTAssertEqual(account.calls.filter { $0 == "completeLink cb:k" }.count, 2)
        XCTAssertEqual(account.calls.filter { $0.hasPrefix("beginLink") }.count, 1)
        XCTAssertEqual(model.links, 1)
    }

    func testTheInviteSurvivesTheAppEnding() async {
        account.inviters = ["t1": Inviter(accountId: "a1", name: "Anna", verified: true)]
        let before = await model()
        await before.openInvite(token: "t1")

        // iOS ended the app while the person was in their authenticator.
        let after = await model()
        XCTAssertEqual(after.invite, .from(name: "Anna"))
        await after.signIn(provider: .google, browser: browser("cb:1"))
        XCTAssertEqual(account.calls.filter { $0.hasPrefix("complete") }, ["completeSignIn cb:1 t1"])

        // Used, it is gone: the next sign-in carries no invite.
        let later = SignInModel(account: FakeAccount(), defaults: defaults)
        await later.check()
        XCTAssertEqual(later.invite, .none)
    }

    func testASignInBeforeTheFirstCheckIsNotUndoneByIt() async {
        let model = SignInModel(account: account, defaults: defaults)
        await model.signIn(provider: .google, browser: browser("cb:1"))
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
        await model.signIn(provider: .google, browser: browser("cb:2"))
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
