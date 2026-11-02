import Foundation

/// A screen's model: something is on its way, it failed, and it can try again.
///
/// Every screen that reads from the core reports the same three things, so the banner above the content
/// and the button in it behave alike everywhere. A screen with nothing to be empty before (`MeModel`)
/// keeps the default `loaded`, which is always true.
@MainActor
protocol ScreenModel: AnyObject {
    /// A call is on its way.
    var busy: Bool { get set }
    /// The first answer has arrived, so an empty screen is really empty.
    var loaded: Bool { get set }
    /// What went wrong, shown above the content.
    var problem: Problem? { get set }
    /// The action `retry` tries again, kept from the failure that set `problem`.
    var failed: (() async -> Void)? { get set }
}

extension ScreenModel {
    /// A model with nothing to be empty before has answered already.
    var loaded: Bool {
        get { true }
        set {}
    }

    /// Tries the action that failed again.
    func retry() async {
        await failed?()
    }

    /// Runs `action`, one at a time; on failure, `again` is what `retry` repeats.
    func perform(again: @escaping () async -> Void, _ action: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        problem = nil
        do {
            try await action()
            failed = nil
        } catch is CancellationError {
            // A task the view cancelled on its way out is not a failure to show.
        } catch {
            failed = again
            loaded = true
            problem = Problem(error)
        }
        busy = false
    }
}
