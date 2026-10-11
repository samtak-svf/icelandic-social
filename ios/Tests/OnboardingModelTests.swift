import Foundation
import XCTest

@testable import Spjall

@MainActor
final class OnboardingModelTests: XCTestCase {
    private let notifier = FakeNotifier()
    private var defaults: UserDefaults!

    override func setUp() async throws {
        defaults = UserDefaults(suiteName: "OnboardingModelTests")
        defaults.removePersistentDomain(forName: "OnboardingModelTests")
    }

    private func model() -> OnboardingModel {
        OnboardingModel(notifier: notifier, defaults: defaults)
    }

    func testANewInstallStartsWithThePhotoThenNotifications() async {
        let model = model()
        XCTAssertEqual(model.step, .photo)
        await model.photoDone()
        XCTAssertEqual(model.step, .notifications)
        XCTAssertEqual(notifier.calls, [], "reaching the priming step must not prompt")
    }

    func testThePromptComesOnlyFromTheEnableButton() async {
        let model = model()
        await model.enable()
        XCTAssertEqual(notifier.calls, [], "no prompt on the photo step")
        await model.photoDone()
        await model.enable()
        XCTAssertEqual(notifier.calls, ["ask"])
        XCTAssertEqual(model.step, .done)
    }

    func testNotNowFinishesWithoutThePrompt() async {
        let model = model()
        await model.photoDone()
        model.notNow()
        XCTAssertEqual(model.step, .done)
        XCTAssertEqual(notifier.calls, [])
    }

    func testAnAnsweredPromptSkipsThePrimingStep() async {
        notifier.undeterminedValue = false
        let model = model()
        await model.photoDone()
        XCTAssertEqual(model.step, .done)
        XCTAssertEqual(notifier.calls, [])
    }

    func testOncePerInstall() async {
        let first = model()
        await first.photoDone()
        first.notNow()
        XCTAssertEqual(model().step, .done)
    }
}
