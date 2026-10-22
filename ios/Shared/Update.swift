import Observation

/// The server's floor (decision 0030). Once any answer says this build is
/// below it, `min` holds the lowest version served and the app shows only the
/// update screen until the person installs a newer build.
@MainActor @Observable
final class Update {
    static let shared = Update()

    private(set) var min: String?
    private(set) var url: String?

    func required(_ min: String, url: String? = nil) {
        self.min = min
        let trimmed = url?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.url = trimmed?.isEmpty == false ? trimmed : nil
    }
}
