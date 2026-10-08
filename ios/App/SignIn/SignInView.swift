import SwiftUI

/// The way in, on cream: the name in capitals, who invited the person (if
/// anyone) in a card, and the Kenni button as a red pill.
struct SignInView: View {
    let model: SignInModel
    let onSignIn: () -> Void
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(verbatim: localized("app_name").capitals)
                .font(TypeStyle.screenTitle)
                .foregroundStyle(BrandTokens.Colors.fg)
                .accessibilityAddTraits(.isHeader)
            switch model.invite {
            case .none, .loading:
                EmptyView()
            case .from(let name?):
                InviteCard(text: Text(verbatim: localized("link_invited_by", name)))
            case .from(nil):
                InviteCard(text: Text("link_invited"))
            case .expired:
                InviteCard(text: Text("link_expired"), color: BrandTokens.Colors.danger)
            }
            Spacer()
            if let problem = model.problem {
                ProblemCard(problem: problem, onRetry: onRetry)
            }
            if model.busy {
                ProgressView().frame(maxWidth: .infinity, minHeight: 50)
            } else {
                Button(action: onSignIn) {
                    Text("sign_in")
                        .font(.sans(15, black: true))
                        .foregroundStyle(BrandTokens.Colors.primaryFg)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background(BrandTokens.Colors.primary, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            Text("sign_in_hint")
                .font(.sans(14))
                .lineSpacing(3)
                .foregroundStyle(BrandTokens.Colors.fg)
            Text("residency_claim")
                .font(.sans(11.5, relativeTo: .footnote))
                .foregroundStyle(BrandTokens.Colors.mutedFg)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(BrandTokens.Colors.bg)
    }
}

/// The invite, or that its link is dead, in a rounded card on the cream.
private struct InviteCard: View {
    let text: Text
    var color = BrandTokens.Colors.fg

    var body: some View {
        text
            .font(.sans(14))
            .foregroundStyle(color)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(BrandTokens.Colors.secondarySubtle, in: RoundedRectangle(cornerRadius: 14))
    }
}
