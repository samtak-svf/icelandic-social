import SwiftUI

/// Kenni's offer (decision 0033), opened from "Ég" and the settings: what
/// linking gives and keeps, then Kenni in the browser, or later.
struct VerifyView: View {
    let model: SignInModel
    let onVerify: () -> Void
    let onLater: () -> Void
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Button(action: onLater) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("back"))
            VerifiedMark(size: 64)
            Text("verify_title")
                .font(TypeStyle.accountName)
                .foregroundStyle(BrandTokens.Colors.fg)
                .accessibilityAddTraits(.isHeader)
            Text("verify_body")
                .font(.sans(14))
                .lineSpacing(3)
                .foregroundStyle(BrandTokens.Colors.fg)
            Point(key: "verify_point_name")
            Point(key: "verify_point_kennitala")
            Point(key: "verify_point_optional")
            Spacer()
            if let problem = model.problem {
                ProblemCard(problem: problem, onRetry: onRetry)
            }
            if model.busy {
                ProgressView().frame(maxWidth: .infinity, minHeight: 52)
            } else {
                Button(action: onVerify) {
                    Text("verify_action")
                        .font(.sans(15, black: true))
                        .foregroundStyle(BrandTokens.Colors.primaryFg)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(BrandTokens.Colors.primary, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
            Button(action: onLater) {
                Text("verify_later")
                    .font(.sans(14, black: true))
                    .foregroundStyle(BrandTokens.Colors.primary)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(BrandTokens.Colors.bg)
        .toolbar(.hidden, for: .navigationBar)
    }
}

/// One thing linking gives or keeps, after a shield.
private struct Point: View {
    let key: LocalizedStringKey

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "checkmark.shield")
                .foregroundStyle(BrandTokens.Colors.primary)
                .accessibilityHidden(true)
            Text(key)
                .font(.sans(14))
                .foregroundStyle(BrandTokens.Colors.fg)
        }
    }
}

/// The way to `VerifyView` from "Ég" and the settings, for an account Kenni has not vouched for.
struct VerifyLink: View {
    let onVerify: () -> Void

    var body: some View {
        Button(action: onVerify) {
            HStack(spacing: 8) {
                VerifiedMark(size: 18)
                Text("verify_cta")
                    .font(.sans(14, black: true))
                    .foregroundStyle(BrandTokens.Colors.primary)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
