import SpjallCore
import SwiftUI

/// Pick one person for a 1:1, or more for a group.
struct PeopleView: View {
    let model: PeopleModel
    let onInvite: () -> Void

    var body: some View {
        List {
            if model.busy {
                ProgressView().progressViewStyle(.linear).listRowSeparator(.hidden)
            }
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }
                    .listRowSeparator(.hidden)
            }
            if model.loaded && model.people.isEmpty && model.problem == nil {
                InviteHint(text: "people_empty", onInvite: onInvite).listRowSeparator(.hidden)
            }
            ForEach(model.people, id: \.account) { person in
                PersonRow(person: person, picked: model.picked.contains(person.account)) {
                    model.toggle(person.account)
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle(Text(model.picked.count > 1 ? "new_group" : "new_conversation"))
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if !model.picked.isEmpty {
                Button {
                    Task { await model.start() }
                } label: {
                    Text("contact_action").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(model.busy)
                .padding(16)
            }
        }
        .task { await model.load() }
    }
}

private struct PersonRow: View {
    let person: Person
    let picked: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 12) {
                Avatar(name: person.name)
                Text(verbatim: shownName(person)).font(.headline)
                if person.verified { VerifiedMark() }
                Spacer()
                Image(systemName: picked ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(picked ? BrandTokens.Colors.primary : BrandTokens.Colors.mutedFg)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(picked ? [.isButton, .isSelected] : .isButton)
    }
}
