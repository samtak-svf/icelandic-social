import SpjallCore
import SwiftUI

/// A circle with the initials of whom a row is about; the row's text says who, so this says nothing.
struct Avatar: View {
    let name: String?

    @ScaledMetric private var size: CGFloat = 48

    var body: some View {
        Text(verbatim: initials(name))
            .font(.headline)
            .foregroundStyle(BrandTokens.Colors.secondaryFg)
            .frame(width: size, height: size)
            .background(BrandTokens.Colors.secondary, in: Circle())
            .accessibilityHidden(true)
    }
}

/// The mark of a name Kenni verified.
struct VerifiedMark: View {
    var body: some View {
        Image(systemName: "checkmark.seal.fill")
            .font(.footnote)
            .foregroundStyle(BrandTokens.Colors.verifiedMark)
            .accessibilityLabel(Text("verified_with_kennitala"))
    }
}

/// The empty list and the empty picker point at the invite link (decision 0022).
struct InviteHint: View {
    let text: LocalizedStringKey
    let onInvite: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text(text).multilineTextAlignment(.center)
            Button("invite", action: onInvite).buttonStyle(.borderedProminent)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
    }
}
