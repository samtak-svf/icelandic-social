import Foundation
import Observation

/// The first launch (decision 0043): after sign-in and before the tabs, once per install, an optional
/// photo and then notifications. The system's notification prompt is asked for only from `enable`,
/// after the person tapped to turn them on, and the step is skipped once the system has an answer:
/// on iOS a refusal cannot be asked again, so it is never asked cold.
@MainActor @Observable
final class OnboardingModel {
    enum Step { case photo, notifications, done }

    private(set) var step: Step

    @ObservationIgnored private let notifier: Notifier
    @ObservationIgnored private let defaults: UserDefaults

    /// In the app's defaults, which go with the install.
    private static let doneKey = "onboarding.done"

    init(notifier: Notifier, defaults: UserDefaults = .standard) {
        self.notifier = notifier
        self.defaults = defaults
        step = defaults.bool(forKey: Self.doneKey) ? .done : .photo
    }

    /// Past the photo, set or skipped.
    func photoDone() async {
        guard step == .photo else { return }
        if await notifier.undetermined() {
            step = .notifications
        } else {
            finish()
        }
    }

    /// "Kveikja á tilkynningum": only now the system's prompt, then on whatever the answer.
    func enable() async {
        guard step == .notifications else { return }
        await notifier.ask()
        finish()
    }

    /// "Ekki núna": no prompt; the notice on the list stays the way back.
    func notNow() {
        finish()
    }

    private func finish() {
        defaults.set(true, forKey: Self.doneKey)
        step = .done
    }
}
