import SpjallCore
import SwiftUI

/// A tap on a person opens the 1:1 with them; "new group" at the top picks several for a group (decision 0043).
struct PeopleView: View {
    let model: PeopleModel
    let onInvite: () -> Void
    /// The picker is opened to find someone, so the search field has focus at once.
    @State private var searching = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        List {
            if model.busy || model.searching {
                ProgressView().progressViewStyle(.linear).listRowSeparator(.hidden)
            }
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }
                    .listRowSeparator(.hidden)
            }
            if !model.group {
                NewGroupRow { model.pickGroup() }
            }
            let searched = !model.query.trimmingCharacters(in: .whitespaces).isEmpty
            let met = searched ? [] : model.people
            let everyone = model.everyone
            let idle = model.loaded && !model.busy && !model.searching && model.problem == nil
            if idle && met.isEmpty && everyone.isEmpty {
                if searched {
                    EmptyState(systemImage: "magnifyingglass", text: "people_none_found").listRowSeparator(.hidden)
                } else {
                    EmptyState(
                        systemImage: "person", text: "people_empty",
                        action: .init(label: "invite", perform: onInvite)
                    )
                    .listRowSeparator(.hidden)
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
        // A search's rows come and go in place of the others' (decision 0043).
        .animation(Motion.rows(reduceMotion: reduceMotion), value: shown)
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
        .navigationTitle(Text(model.group ? "new_group" : "new_conversation"))
        .navigationBarTitleDisplayMode(.inline)
        // Out of picking several back to one tap, not out of the picker.
        .navigationBarBackButtonHidden(model.group)
        .toolbar {
            if model.group {
                ToolbarItem(placement: .cancellationAction) {
                    Button("cancel") { model.single() }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if model.group && !model.picked.isEmpty {
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
    /// The accounts the list shows, in order: what its animation follows.
    private var shown: [String] {
        let searched = !model.query.trimmingCharacters(in: .whitespaces).isEmpty
        return (searched ? [] : model.people.map(\.account)) + model.everyone.map(\.account)
    }

    private func rows(_ people: [Person]) -> some View {
        ForEach(people, id: \.account) { person in
            if model.group {
                PersonRow(person: person, picked: model.picked.contains(person.account)) {
                    model.toggle(person.account)
                }
            } else {
                PersonRow(person: person, picked: nil) {
                    Task { await model.open(person.account) }
                }
            }
        }
    }
}

/// Switches the picker to picking several people for a group.
private struct NewGroupRow: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(BrandTokens.Colors.primaryFg)
                    .frame(width: 46, height: 46)
                    .background(BrandTokens.Colors.primary, in: Circle())
                    .accessibilityHidden(true)
                Text("new_group").font(.sans(14.5, black: true))
                Spacer()
            }
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// One person: a tap opens the 1:1 when `picked` is nil, and picks or unpicks them in a group otherwise.
private struct PersonRow: View {
    let person: Person
    let picked: Bool?
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 12) {
                Avatar(person: person)
                Text(verbatim: shownName(person)).font(.sans(14.5, black: true))
                if person.verified { VerifiedMark() }
                Spacer()
                if let picked {
                    Image(systemName: picked ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(picked ? BrandTokens.Colors.primary : BrandTokens.Colors.mutedFg)
                        .accessibilityHidden(true)
                }
            }
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(picked == true ? [.isButton, .isSelected] : .isButton)
    }
}
