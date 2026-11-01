import Foundation
import Observation
import SpjallCore

/// Linking a browser from this phone (decisions 0064, 0077): the code the browser shows is scanned or
/// pasted, checked against the server's request, then approved with the phone's signature, with as much of
/// the history as the person chooses.
@MainActor @Observable
final class LinkModel {
    enum Step: Equatable {
        /// The camera looks for the code.
        case scanning
        /// The person types or pastes it.
        case pasting
        case inspecting
        case approve(LinkRequest)
        case sending
        case done
        /// A string key naming what is wrong with the code or the request.
        case error(String)
        /// A failure no key names, such as no network.
        case problem(Problem)
    }

    /// How much of this phone's history goes to the browser (decision 0077).
    enum History: Equatable {
        /// The last 90 days.
        case recent
        case all
        case nothing
    }

    private(set) var step: Step = .scanning
    var history: History = .recent
    /// The text in the paste field.
    var draft = ""

    static let recentMillis = UInt64(Limits.linkRecentDays) * 86_400 * 1000

    private let account: Account
    private let now: @Sendable () -> UInt64
    private let isCode: @Sendable (String) -> Bool
    /// The code that was accepted, kept for the approval.
    private var code: String?

    init(
        account: Account,
        now: @escaping @Sendable () -> UInt64 = nowMillis,
        isCode: @escaping @Sendable (String) -> Bool = { isLinkCode(text: $0) }
    ) {
        self.account = account
        self.now = now
        self.isCode = isCode
    }

    /// The camera reads `text`; anything but a link code is ignored so the scanner goes on looking.
    func scanned(_ text: String) async {
        guard step == .scanning, isCode(text) else { return }
        await inspect(text)
    }

    /// The person submits what they typed or pasted.
    func submitDraft() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isCode(text) else {
            step = .error("device_link_invalid")
            return
        }
        await inspect(text)
    }

    func paste() { step = .pasting }

    func scan() { step = .scanning }

    /// Back to the start after an error.
    func restart() {
        code = nil
        step = .scanning
    }

    func approve() async {
        guard case .approve = step, let code else { return }
        let account = account
        let (since, send) = request()
        step = .sending
        do {
            _ = try await offMain { try account.approveLink(code: code, since: since, send: send) }
            step = .done
        } catch {
            step = Self.step(for: error)
        }
    }

    /// The `since` and `send` the chosen history asks of the core.
    func request() -> (since: UInt64?, send: Bool) {
        switch history {
        case .recent: (now() > Self.recentMillis ? now() - Self.recentMillis : 0, true)
        case .all: (nil, true)
        case .nothing: (nil, false)
        }
    }

    private func inspect(_ text: String) async {
        let account = account
        step = .inspecting
        do {
            let request = try await offMain { try account.inspectLink(code: text) }
            code = text
            step = request.approved ? .error("device_link_already") : .approve(request)
        } catch {
            step = Self.step(for: error)
        }
    }

    nonisolated static func step(for error: Error) -> Step {
        switch error {
        case CoreError.LinkCodeInvalid: .error("device_link_invalid")
        case CoreError.LinkKeyMismatch: .error("device_link_mismatch")
        case CoreError.LinkExpired: .error("device_link_expired")
        case CoreError.LinkAlreadyApproved: .error("device_link_already")
        default: .problem(Problem(error))
        }
    }
}
