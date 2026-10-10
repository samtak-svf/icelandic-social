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

/// A circle with the photo of whom a row is about (decision 0039), or their initials while it loads, when
/// there is none and when it cannot be had; a verified person's photo keeps the gold as a ring. The row's
/// text says who, so this says nothing.
struct Avatar: View {
    let name: String?
    var kind = AvatarKind.unverified
    var size: CGFloat = 46
    var photo: PhotoOf?

    @Environment(\.photos) private var photos
    @State private var loaded: UIImage?

    var body: some View {
        let image = photo.flatMap { photo in loaded ?? photos?.kept(photo) }
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(Circle())
                    .overlay {
                        if kind == .verified { Circle().strokeBorder(kind.fill, lineWidth: 2) }
                    }
            } else {
                Text(verbatim: initials(name))
                    .font(.sans(size * 0.33, black: true))
                    .foregroundStyle(kind.ink)
            }
        }
        .frame(width: size, height: size)
        .background(kind.fill, in: Circle())
        .accessibilityHidden(true)
        .task(id: photo) {
            loaded = nil
            guard let photo, let photos else { return }
            loaded = await photos.load(photo)
        }
    }
}

extension Avatar {
    /// One person: their photo, or their initials in the fill their mark sets.
    init(person: Person, size: CGFloat = 46) {
        self.init(name: person.name, kind: avatarKind(person), size: size, photo: person.photoOf)
    }
}

/// The mark of a name Kenni verified: a gold shield with a white tick.
struct VerifiedMark: View {
    var size: CGFloat = 14

    var body: some View {
        ZStack {
            Shield().fill(BrandTokens.Colors.verifiedMark)
            Tick().stroke(
                BrandTokens.Colors.surface,
                style: StrokeStyle(lineWidth: size / 12, lineCap: .round, lineJoin: .round))
        }
        .frame(width: size, height: size)
        .accessibilityElement()
        .accessibilityLabel(Text("verified_with_kennitala"))
    }

    /// `M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5l8-3z` in a 24 box.
    private struct Shield: Shape {
        func path(in rect: CGRect) -> Path {
            let s = min(rect.width, rect.height) / 24
            func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }
            var path = Path()
            path.move(to: p(12, 2))
            path.addLine(to: p(20, 5))
            path.addLine(to: p(20, 11))
            path.addCurve(to: p(12, 22), control1: p(20, 16), control2: p(16.6, 20.4))
            path.addCurve(to: p(4, 11), control1: p(7.4, 20.4), control2: p(4, 16))
            path.addLine(to: p(4, 5))
            path.closeSubpath()
            return path
        }
    }

    /// `M8.5 12l2.5 2.5 4.5-5` in a 24 box.
    private struct Tick: Shape {
        func path(in rect: CGRect) -> Path {
            let s = min(rect.width, rect.height) / 24
            func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }
            var path = Path()
            path.move(to: p(8.5, 12))
            path.addLine(to: p(11, 14.5))
            path.addLine(to: p(15.5, 9.5))
            return path
        }
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
