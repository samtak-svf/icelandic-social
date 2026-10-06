import SwiftUI

/// The way in: who invited the person, if anyone, and the Kenni button.
struct SignInView: View {
    let model: SignInModel
    let onSignIn: () -> Void
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("app_name")
                .font(.largeTitle.bold())
                .foregroundStyle(BrandTokens.Colors.primary)
            switch model.invite {
            case .none, .loading:
                EmptyView()
            case .from(let name?):
                Text(verbatim: localized("link_invited_by", name)).font(.title3)
            case .from(nil):
                Text("link_invited").font(.title3)
            case .expired:
                Text("link_expired").font(.title3).foregroundStyle(BrandTokens.Colors.danger)
            }
            Spacer()
            if let problem = model.problem {
                ProblemCard(problem: problem, onRetry: onRetry)
            }
            if model.busy {
                ProgressView().frame(maxWidth: .infinity)
            } else {
                Button(action: onSignIn) {
                    Text("sign_in").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            Text("sign_in_hint").font(.body)
            Text("residency_claim")
                .font(.footnote)
                .foregroundStyle(BrandTokens.Colors.mutedFg)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(BrandTokens.Colors.surface)
    }
}
