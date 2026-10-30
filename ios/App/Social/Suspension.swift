import Observation
import SpjallCore
import SwiftUI

/// The suspension in force on this account (decision 0115), the one the server refuses writes for with the code
/// `suspended`. One that has ended no longer stands, though the server may not have dropped it yet.
func standingSuspension(_ me: Me, now: Date = Date()) -> AccountSuspension? {
    guard let suspension = me.suspension else { return nil }
    guard let until = suspension.until else { return suspension }
    return Dates.at(until) > now ? suspension : nil
}

/// Reads whether this account is suspended, for the screens that write. A failed read keeps what was known, so a
/// lost connection never lifts or sets a notice.
@MainActor @Observable
final class SuspensionModel {
    private(set) var suspension: AccountSuspension?

    private let social: Social
    private let now: @Sendable () -> Date

    init(social: Social, now: @escaping @Sendable () -> Date = { Date() }) {
        self.social = social
        self.now = now
    }

    func load() async {
        let social = social
        guard let me = try? await offMain({ try social.me() }) else { return }
        suspension = standingSuspension(me, now: now())
    }
}

extension EnvironmentValues {
    /// The suspension in force, set on the hosted social stacks only: a conversation is not hosted content and is
    /// never refused, so it has no notice and no disabled control (0115).
    @Entry var suspension: AccountSuspension?
}

extension View {
    /// Provides the suspension in force to the stack's screens, read again whenever the app comes forward.
    func suspensionHost(_ model: SuspensionModel) -> some View {
        modifier(SuspensionHost(model: model))
    }
}

private struct SuspensionHost: ViewModifier {
    let model: SuspensionModel
    @Environment(\.scenePhase) private var phase

    func body(content: Self.Content) -> some View {
        content
            .environment(\.suspension, model.suspension)
            .task(id: phase) { if phase == .active { await model.load() } }
    }
}

/// The sentence a suspended account reads on a screen that writes: what still works and what does not, and until
/// when. A link takes it to the statement of reasons.
struct SuspendedNotice: View {
    @Environment(\.suspension) private var suspension
    /// Offers the statement of reasons: not on a sheet, which has no stack to push it onto.
    var linksReason = true

    var body: some View {
        if let suspension {
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: suspendedNoticeText(suspension))
                    .font(.sans(13.5))
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .fixedSize(horizontal: false, vertical: true)
                if linksReason {
                    NavigationLink(value: SocialRoute.statements) {
                        Text("statement_open")
                            .font(.sans(13.5, black: true))
                            .foregroundStyle(BrandTokens.Colors.primary)
                            .frame(minHeight: 44, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: 14))
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .accessibilityIdentifier("suspended-notice")
        }
    }
}

/// `suspended_notice`, with its end when it has one.
func suspendedNoticeText(_ suspension: AccountSuspension) -> String {
    guard let until = suspension.until else { return localized("suspended_notice") }
    return localized("suspended_notice_until", Dates.dateTime(Dates.at(until)))
}

/// What a refused write says (`problem_suspended`), with the end of the suspension when `Me` has one.
func suspendedProblemText(_ suspension: AccountSuspension?) -> String {
    guard let until = suspension?.until else { return localized("problem_suspended") }
    return localized("problem_suspended_until", Dates.dateTime(Dates.at(until)))
}
