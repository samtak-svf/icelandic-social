import SpjallCore
import SwiftUI

/// Another account's wall (decision 0034): who they are, a way into a private
/// 1:1 with them without an invite link, and what they have posted.
struct WallView: View {
    let model: PostsModel
    let onReplies: (String) -> Void
    /// The 1:1 to go into.
    let onOpened: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            BackBar()
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
            }
            ScrollView {
                VStack(spacing: 0) {
                    if let person = model.person {
                        WallHead(person: person, contact: model.other && !model.blocked, busy: model.busy) {
                            Task {
                                if let id = await model.contact() { onOpened(id) }
                            }
                        }
                    }
                    // Every post here is the owner's, so their name leads nowhere new.
                    PostList(model: model, empty: "wall_empty", onAuthor: { _ in }, onReplies: onReplies)
                }
            }
            .refreshable { await model.refresh() }
        }
        .background(BrandTokens.Colors.surface)
        .toolbar(.hidden, for: .navigationBar)
        .background { SwipeBack().frame(width: 0, height: 0) }
        .task {
            if !model.loaded { await model.refresh() }
        }
    }
}

/// The large circle, the name and mark, and the button into the 1:1.
private struct WallHead: View {
    let person: Person
    let contact: Bool
    let busy: Bool
    let onContact: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Avatar(name: person.name, kind: avatarKind(person), size: 88)
            HStack(spacing: 6) {
                Text(verbatim: shownName(person).capitals)
                    .font(TypeStyle.accountName)
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
                if person.verified { VerifiedMark(size: 18) }
            }
            if person.verified { SectionLabel(text: localized("verified_with_kennitala")) }
            if contact {
                Button(action: onContact) {
                    Text("contact_action")
                        .font(.sans(13, black: true))
                        .foregroundStyle(BrandTokens.Colors.primaryFg)
                        .padding(.horizontal, 28)
                        .frame(minHeight: 40)
                        .background(BrandTokens.Colors.primary, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(busy)
                .padding(.top, 4)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity)
        .background(BrandTokens.Colors.bg)
    }
}
