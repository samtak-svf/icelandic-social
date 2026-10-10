import SpjallCore
import SwiftUI

/// Pick one person for a 1:1, or more for a group.
struct PeopleView: View {
    let model: PeopleModel
    let onInvite: () -> Void
    /// The picker is opened to find someone, so the search field has focus at once.
    @State private var searching = false

    var body: some View {
        List {
            if model.busy || model.searching {
                ProgressView().progressViewStyle(.linear).listRowSeparator(.hidden)
            }
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }
                    .listRowSeparator(.hidden)
            }
            let searched = !model.query.trimmingCharacters(in: .whitespaces).isEmpty
            let met = searched ? [] : model.people
            let everyone = model.everyone
            let idle = model.loaded && !model.busy && !model.searching && model.problem == nil
            if idle && met.isEmpty && everyone.isEmpty {
                if searched {
                    Text("people_none_found").listRowSeparator(.hidden)
                } else {
                    InviteHint(text: "people_empty", onInvite: onInvite).listRowSeparator(.hidden)
                }
            }
            Section {
                rows(met)
            } header: {
                if !met.isEmpty && !everyone.isEmpty { Text("people_met") }
            }
            Section {
                rows(everyone)
                if model.next != nil {
                    Color.clear.frame(height: 1).listRowSeparator(.hidden)
                        .task(id: model.next) { await model.more() }
                }
            } header: {
                if !met.isEmpty && !everyone.isEmpty { Text("people_everyone") }
            }
        }
        .listStyle(.plain)
        .searchable(
            text: Binding(get: { model.query }, set: { model.query = $0 }),
            isPresented: $searching,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: Text("people_search")
        )
        .task(id: model.query) {
            guard model.loaded else { return }
            await model.search()
        }
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
        // Asked for once the push has settled; asked for in onAppear it can be lost mid-transition.
        .task { searching = true }
    }
}

extension PeopleView {
    private func rows(_ people: [Person]) -> some View {
        ForEach(people, id: \.account) { person in
            PersonRow(person: person, picked: model.picked.contains(person.account)) {
                model.toggle(person.account)
            }
        }
    }
}

private struct PersonRow: View {
    let person: Person
    let picked: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 12) {
                Avatar(person: person)
                Text(verbatim: shownName(person)).font(.sans(14.5, black: true))
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
