import SpjallCore
import SwiftUI

/// This account's own lists (decision 0114): the requests to it, its friends, the requests it sent, and whom it
/// snoozed. Nobody else's list exists.
struct FriendsView: View {
    let model: FriendsModel
    @State private var text = ""

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if !model.loaded {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
                if model.loaded {
                    IncomingSection(model: model)
                    FriendsSection(model: model, text: $text)
                    SentSection(model: model)
                    SuggestedSection(model: model)
                    SnoozedSection(model: model)
                }
            }
            .padding(16)
        }
        .background(BrandTokens.Colors.bg)
        .navigationTitle(Text("person_friends"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .bellInNavigationBar()
        .safeAreaInset(edge: .top) {
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
            }
        }
        .task {
            await model.load()
            await model.suggestions.load()
        }
    }
}

private struct IncomingSection: View {
    let model: FriendsModel

    var body: some View {
        if !model.requests.incoming.isEmpty {
            CardLabel(key: "friends_incoming")
            Panel {
                ForEach(Array(model.requests.incoming.enumerated()), id: \.element.person.accountId) { index, request in
                    if index > 0 { Hairline() }
                    VStack(alignment: .leading, spacing: 0) {
                        AuthorLinkRow(author: request.person)
                        HStack(spacing: 8) {
                            answer("person_accept", filled: true) { await model.accept(request.person.accountId) }
                            answer("person_decline", filled: false) { await model.decline(request.person.accountId) }
                        }
                        .padding([.horizontal, .bottom], 12)
                    }
                }
            }
        }
    }

    private func answer(_ key: String, filled: Bool, _ action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            PillLabel(text: LocalizedStringKey(key), filled: filled)
        }
        .buttonStyle(.plain)
        .disabled(model.busy)
    }
}

private struct FriendsSection: View {
    let model: FriendsModel
    @Binding var text: String

    private var sorting: Binding<FriendSort> {
        Binding(get: { model.sort }, set: { next in Task { await model.choose(next) } })
    }

    var body: some View {
        CardLabel(key: "person_friends")
        if let page = model.page {
            Text(verbatim: plural("person_friend_count", Int(page.count)))
                .font(TypeStyle.meta).foregroundStyle(BrandTokens.Colors.mutedFg).padding(.leading, 4)
        }
        HStack(spacing: 8) {
            TextField("people_search", text: $text)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.search)
                .onSubmit { Task { await model.search(text) } }
            Picker("friends_sort_label", selection: sorting) {
                Text("friends_sort_newest").tag(FriendSort.newest)
                Text("friends_sort_name").tag(FriendSort.name)
            }
            .pickerStyle(.menu)
        }
        if let page = model.page, page.friends.isEmpty {
            EmptyState(systemImage: "person.2", text: model.searched ? "friends_search_empty" : "friends_empty")
        } else if let page = model.page {
            Panel {
                ForEach(Array(page.friends.enumerated()), id: \.element.person.accountId) { index, friend in
                    if index > 0 { Hairline() }
                    AuthorLinkRow(
                        author: friend.person,
                        detail: localized("person_friends_since", Dates.date(Dates.at(friend.since))))
                }
            }
        }
    }
}

private struct SentSection: View {
    let model: FriendsModel

    var body: some View {
        if !model.requests.sent.isEmpty {
            CardLabel(key: "friends_sent")
            Panel {
                ForEach(Array(model.requests.sent.enumerated()), id: \.element.person.accountId) { index, request in
                    if index > 0 { Hairline() }
                    HStack {
                        AuthorLinkRow(author: request.person)
                        Button {
                            Task { await model.cancel(request.person.accountId) }
                        } label: {
                            PillLabel(text: "person_cancel_request", filled: false, wide: false)
                        }
                        .buttonStyle(.plain)
                        .disabled(model.busy)
                        .padding(.trailing, 12)
                    }
                }
            }
        }
    }
}

private struct SnoozedSection: View {
    let model: FriendsModel

    var body: some View {
        if !model.snoozes.isEmpty {
            CardLabel(key: "friends_snoozed")
            Panel {
                ForEach(Array(model.snoozes.enumerated()), id: \.element.person.accountId) { index, snooze in
                    if index > 0 { Hairline() }
                    HStack {
                        AuthorLinkRow(
                            author: snooze.person,
                            detail: localized("person_snoozed_until", Dates.date(Dates.at(snooze.until))))
                        Button {
                            Task { await model.unsnooze(snooze.person.accountId) }
                        } label: {
                            PillLabel(text: "person_unsnooze", filled: false, wide: false)
                        }
                        .buttonStyle(.plain)
                        .disabled(model.busy)
                        .padding(.trailing, 12)
                    }
                }
            }
        }
    }
}

/// Below the lists: no heading at all when nobody is to be shown. A long name gives way to the button.
private struct SuggestedSection: View {
    let model: FriendsModel

    var body: some View {
        let people = model.suggestions.people
        if !people.isEmpty {
            CardLabel(key: "friends_suggested")
            Panel {
                ForEach(Array(people.enumerated()), id: \.element.accountId) { index, person in
                    if index > 0 { Hairline() }
                    HStack(spacing: 0) {
                        AuthorLinkRow(author: person, lineLimit: 2)
                        Button {
                            Task { await model.ask(person.accountId) }
                        } label: {
                            PillLabel(text: "person_add_friend", filled: true, wide: false)
                                .frame(minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .fixedSize()
                        .layoutPriority(1)
                        .disabled(model.busy)
                        .padding(.trailing, 12)
                    }
                }
            }
            if model.suggestions.next != nil {
                Color.clear.frame(height: 1)
                    .task(id: model.suggestions.wantsMore) {
                        if model.suggestions.wantsMore { await model.suggestions.more() }
                    }
            }
        }
    }
}

/// The friends with a model of their own, for the settings' stack, which keeps no route models.
struct OwnFriendsView: View {
    @State private var model: FriendsModel

    init(social: Social) {
        _model = State(initialValue: FriendsModel(social: social))
    }

    var body: some View { FriendsView(model: model) }
}
