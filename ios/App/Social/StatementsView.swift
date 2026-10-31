import SpjallCore
import SwiftUI

/// What moderators did to this account's content and why (0115). It never says who acted.
struct StatementsView: View {
    let model: StatementsModel
    /// The decision whose review waits for the ask to be confirmed, since it cannot be taken back.
    @State private var asking: ModerationStatement?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if !model.loaded {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
                if model.loaded && model.statements.isEmpty && model.problem == nil {
                    EmptyState(systemImage: "checkmark.shield", text: "statements_empty")
                }
                ForEach(model.statements, id: \.entryId) { statement in
                    StatementCard(statement: statement, enabled: !model.busy) { asking = statement }
                }
                if model.next != nil && model.problem == nil {
                    Color.clear.frame(height: 1).task(id: model.next) { await model.more() }
                }
            }
            .padding(16)
        }
        .background(BrandTokens.Colors.bg)
        .navigationTitle(Text("statements_title"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .bellInNavigationBar()
        .safeAreaInset(edge: .top) {
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
            }
        }
        .task { await model.load() }
        .confirmationDialog(
            "statement_ask_confirm",
            isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }),
            titleVisibility: .visible,
            presenting: asking
        ) { asking in
            Button("statement_ask") { Task { await model.ask(asking.entryId) } }
            Button("cancel", role: .cancel) {}
        }
    }
}

/// The statements with a model of their own, for the settings' stack, which keeps no route models.
struct OwnStatementsView: View {
    @State private var model: StatementsModel

    init(social: Social) {
        _model = State(initialValue: StatementsModel(social: social))
    }

    var body: some View { StatementsView(model: model) }
}

/// One statement: what was done, why, the text while it is kept, and the review.
private struct StatementCard: View {
    let statement: ModerationStatement
    let enabled: Bool
    let onAsk: () -> Void

    var body: some View {
        Panel {
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: statementLabel(statement.action, until: statement.until))
                    .font(.sans(14.5, black: true))
                    .accessibilityAddTraits(.isHeader)
                muted(relativeTime(statement.createdAt))
                Text(verbatim: labelled("report_reason", statement.reason)).font(.sans(14.5))
                if let body = statement.body {
                    Text(verbatim: body).font(.sans(14.5))
                } else if statement.target.kind != .account {
                    muted(localized("statement_text_gone"))
                }
                if let review = statement.review { reviewed(review, action: statement.action) }
                if statement.canAsk { ask }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder private func reviewed(_ review: ModerationReview, action: ModerationLogAction) -> some View {
        if let sentence = reviewSentence(review, action: action) {
            Text(verbatim: sentence).font(.sans(14.5))
        }
        if let reason = review.reason {
            Text(verbatim: labelled("statement_review_reason", reason)).font(.sans(14.5))
        }
    }

    @ViewBuilder private var ask: some View {
        muted(localized("statement_ask_once"))
        Button(action: onAsk) {
            PillLabel(text: "statement_ask", filled: true, wide: false)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private func muted(_ text: String) -> some View {
        Text(verbatim: text).font(.sans(12.5)).foregroundStyle(BrandTokens.Colors.mutedFg)
    }

    private func labelled(_ key: String, _ text: String) -> String {
        "\(localized(key)): \(text)"
    }
}

/// The sentence a review's state reads as; a state a later server adds reads as nothing. An overturned suspension
/// lifts the ban, or leaves a later one standing (0115); other actions bring the content back or do not.
func reviewSentence(_ review: ModerationReview, action: ModerationLogAction) -> String? {
    switch review.state {
    case .open: localized("statement_review_open")
    case .upheld: localized("statement_review_upheld")
    case .overturned where action == .suspendAccount:
        localized(review.restored ? "statement_review_overturned_lifted" : "statement_review_overturned_later_stands")
    case .overturned:
        localized(review.restored ? "statement_review_overturned" : "statement_review_overturned_not_restored")
    case .unknown: nil
    }
}

/// What a statement says was done; an action a later server adds reads as done.
func statementLabel(_ action: ModerationLogAction, until: UInt64? = nil) -> String {
    switch action {
    case .clearAccountPhoto: return localized("moderation_decision_clear_account_photo")
    case .clearAccountBio: return localized("moderation_decision_clear_account_bio")
    case .clearAccountCover: return localized("moderation_decision_clear_account_cover")
    case .readReported: return localized("moderation_decision_read_reported")
    default: return logActionLabel(action, until: until) ?? localized("moderation_done")
    }
}
