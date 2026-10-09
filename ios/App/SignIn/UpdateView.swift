import SwiftUI

/// All the app shows once the server no longer serves this build (decision
/// 0030): nothing else would work, so it says so and leads to the update.
struct UpdateView: View {
    let onUpdate: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("update_required_title")
                .font(TypeStyle.screenTitle)
                .foregroundStyle(BrandTokens.Colors.fg)
                .accessibilityAddTraits(.isHeader)
            Text("update_required_body")
                .font(.sans(14))
                .lineSpacing(3)
                .foregroundStyle(BrandTokens.Colors.fg)
            Spacer()
            Button(action: onUpdate) {
                Text("update_required_action")
                    .font(.sans(15, black: true))
                    .foregroundStyle(BrandTokens.Colors.primaryFg)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(BrandTokens.Colors.primary, in: Capsule())
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(BrandTokens.Colors.bg)
    }
}
