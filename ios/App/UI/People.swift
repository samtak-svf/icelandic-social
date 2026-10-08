import SpjallCore
import SwiftUI

/// Who a circle stands for, which sets its colours.
enum AvatarKind {
    /// One person Kenni verified: gold.
    case verified
    /// One person who is not: a faint wash of the text colour.
    case unverified
    /// More than one person.
    case group
    /// The person themselves, on "Ég": dark.
    case me

    var fill: Color {
        switch self {
        case .verified: BrandTokens.Colors.secondary
        case .unverified: BrandTokens.Colors.fg.opacity(0.09)
        case .group: BrandTokens.Colors.secondarySubtle
        case .me: BrandTokens.Colors.fg
        }
    }

    var ink: Color {
        switch self {
        case .verified: BrandTokens.Colors.secondaryFg
        case .unverified, .group: BrandTokens.Colors.fg
        case .me: BrandTokens.Colors.surface
        }
    }
}

func avatarKind(_ conversation: Conversation) -> AvatarKind {
    if conversation.members.count > 1 { return .group }
    return conversation.members.first?.verified == true ? .verified : .unverified
}

func avatarKind(_ person: Person) -> AvatarKind {
    person.verified ? .verified : .unverified
}

/// A circle with the initials of whom a row is about; the row's text says who, so this says nothing.
struct Avatar: View {
    let name: String?
    var kind = AvatarKind.unverified
    var size: CGFloat = 46

    var body: some View {
        Text(verbatim: initials(name))
            .font(.sans(size * 0.33, black: true))
            .foregroundStyle(kind.ink)
            .frame(width: size, height: size)
            .background(kind.fill, in: Circle())
            .accessibilityHidden(true)
    }
}

/// The mark of a name Kenni verified: a gold dot.
struct VerifiedMark: View {
    var size: CGFloat = 7

    var body: some View {
        Circle()
            .fill(BrandTokens.Colors.verifiedMark)
            .frame(width: size, height: size)
            .accessibilityElement()
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
