import SpjallCore
import SwiftUI

/// A tap on a person opens the 1:1 with them; "new group" at the top picks several for a group (decision 0043).
struct PeopleView: View {
    let model: PeopleModel
    let onInvite: () -> Void
    /// The picker is opened to find someone, so the search field has focus at once.
    @State private var searching = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dismiss) private var dismiss

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
        .navigationTitle(Text(model.adding ? "add_people_title" : (model.group ? "new_group" : "new_conversation")))
        .navigationBarTitleDisplayMode(.inline)
        // A back button of the app's own in both modes (decision 0047): out of picking several back to
        // one tap, otherwise out of the picker. Swiping from the edge does the same.
        .toolbar(.visible, for: .navigationBar)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    if model.back() { dismiss() }
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(BrandTokens.Colors.fg)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("back"))
            }
        }
        .bellInNavigationBar()
        .background {
            SwipeBack(instead: (model.group && !model.adding) ? { _ = model.back() } : nil).frame(width: 0, height: 0)
        }
        .safeAreaInset(edge: .bottom) {
            if model.group && !model.picked.isEmpty {
                Button {
                    Task { await model.start() }
                } label: {
                    Text(model.adding ? "add_people_confirm" : "contact_action").frame(maxWidth: .infinity)
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
                let isExisting = model.existing.contains(person.account)
                PersonRow(
                    person: person,
                    picked: isExisting || model.picked.contains(person.account),
                    disabled: isExisting
                ) {
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
    var disabled = false
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
                        .opacity(disabled ? 0.5 : 1)
                        .accessibilityHidden(true)
                }
            }
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(picked == true ? [.isButton, .isSelected] : .isButton)
    }
}
