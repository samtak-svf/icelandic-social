import SpjallCore
import SwiftUI

/// A person as the reader sees them (decision 0114): who they are, what is between the two, and what can be done
/// about it. The wall is another screen's; this one shows the friendship.
struct PersonView: View {
    let model: PersonModel
    let social: Social
    /// Opens the settings: set on this account's own wall, which is the Me tab's root (decision 0115).
    var onSettings: (() -> Void)?
    /// This account's own record, set on its own wall, where the photo is chosen, framed and removed as on the web.
    var own: MeModel?
    @State private var wall: WallModel?
    @State private var ending = false
    @State private var reporting = false
    @State private var blocking = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let person = model.person {
                    PersonHeader(person: person)
                    if let own { PhotoControls(model: own, hasPhoto: person.photo != nil) }
                    PersonActions(model: model, person: person)
                    if let wall { WallView(model: wall, person: person) }
                } else if !model.loaded {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
                if model.loaded && model.person == nil && model.problem == nil {
                    EmptyState(systemImage: "person.slash", text: "person_deleted")
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(BrandTokens.Colors.bg)
        .navigationTitle(Text(verbatim: model.person?.shownName ?? ""))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbar { if let person = model.person, person.relation != .oneself { menu(person) } }
        .toolbar { if let onSettings { gear(onSettings) } }
        .bellInNavigationBar()
        .safeAreaInset(edge: .top) {
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
            }
        }
        .task {
            if wall == nil { wall = WallModel(social: social, accountId: model.accountId) }
            await model.load()
        }
        .confirmationDialog(
            Text(verbatim: model.person.map { localized("friend_end_confirm", $0.shownName) } ?? ""),
            isPresented: $ending, titleVisibility: .visible
        ) {
            Button("friend_end", role: .destructive) { Task { await model.end() } }
            Button("cancel", role: .cancel) {}
        }
        .confirmationDialog(
            Text(verbatim: model.person.map { localized("block_confirm", $0.shownName) } ?? ""),
            isPresented: $blocking, titleVisibility: .visible
        ) {
            Button("block", role: .destructive) { Task { await model.block() } }
            Button("cancel", role: .cancel) {}
        }
        .onChange(of: own?.me?.photo) { _, _ in Task { await model.load() } }
        .onChange(of: model.blocked) { _, blocked in
            if blocked { dismiss() }
        }
        .sheet(isPresented: $reporting) {
            ReportSheet(social: social, target: ReportTarget(kind: .account, id: model.accountId))
        }
    }

    /// The gear on this account's own wall: everything the Me tab held is behind it.
    private func gear(_ open: @escaping () -> Void) -> some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button(action: open) { Image(systemName: "gearshape") }
                .accessibilityLabel(Text("settings_title"))
        }
    }

    /// Hide their posts for a while, end the friendship, report the account.
    private func menu(_ person: PersonProfile) -> some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                if person.snoozedUntil == nil {
                    Button("person_snooze") { Task { await model.snooze() } }
                } else {
                    Button("person_unsnooze") { Task { await model.unsnooze() } }
                }
                if person.relation == .friends {
                    Button("friend_end", role: .destructive) { ending = true }
                }
                Button("report_title", role: .destructive) { reporting = true }
                Button("block", role: .destructive) { blocking = true }
            } label: {
                Image(systemName: "ellipsis")
            }
            .disabled(model.busy)
            .accessibilityLabel(Text("report_title"))
        }
    }
}

/// The photo, the name and the counts.
private struct PersonHeader: View {
    let person: PersonProfile

    var body: some View {
        VStack(spacing: 6) {
            Avatar(
                name: person.name, kind: person.verified ? .verified : .unverified, size: 72, photo: person.photoOf)
            NameWithMark(name: person.shownName, verified: person.verified, markSize: 14, font: .sans(20, black: true))
            Text(verbatim: plural("person_friend_count", Int(person.friendCount)))
            if person.relation != .oneself && person.mutualCount > 0 {
                Text(verbatim: plural("person_mutual_count", Int(person.mutualCount)))
            }
            if let since = person.friendsSince {
                Text(verbatim: localized("person_friends_since", Dates.date(Dates.at(since))))
            }
            if let until = person.snoozedUntil {
                Text(verbatim: localized("person_snoozed_until", Dates.date(Dates.at(until))))
            }
        }
        .font(TypeStyle.meta)
        .foregroundStyle(BrandTokens.Colors.mutedFg)
        .frame(maxWidth: .infinity)
    }
}

/// What the relation offers: the request to send, to take back, or to answer.
private struct PersonActions: View {
    let model: PersonModel
    let person: PersonProfile

    var body: some View {
        let offer = relationOffer(person.relation)
        VStack(spacing: 8) {
            if let sentence = offer.sentence {
                Text(LocalizedStringKey(sentence)).font(TypeStyle.meta).foregroundStyle(BrandTokens.Colors.mutedFg)
            }
            HStack(spacing: 8) {
                ForEach(offer.actions, id: \.self) { action in
                    Button {
                        Task { await model.perform(action) }
                    } label: {
                        PillLabel(text: LocalizedStringKey(action.label), filled: action.primary)
                    }
                    .buttonStyle(.plain)
                    .disabled(model.busy)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The communities they share with the reader, and the friends the two have in common.
struct PersonLinks: View {
    let person: PersonProfile

    var body: some View {
        if !person.sharedCommunities.isEmpty {
            CardLabel(key: "person_shared_communities")
            Panel {
                ForEach(Array(person.sharedCommunities.enumerated()), id: \.element.communityId) { index, community in
                    if index > 0 { Hairline() }
                    NavigationLink(value: SocialRoute.community(community.communityId)) {
                        Text(verbatim: community.name).font(TypeStyle.bubble).padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        if !person.mutualFriends.isEmpty {
            CardLabel(key: "person_mutual_heading")
            Panel {
                ForEach(Array(person.mutualFriends.enumerated()), id: \.element.accountId) { index, author in
                    if index > 0 { Hairline() }
                    AuthorLinkRow(author: author)
                }
            }
        }
    }
}

/// A row that opens the person: their photo and name.
struct AuthorLinkRow: View {
    let author: Author
    var detail: String?

    var body: some View {
        NavigationLink(value: SocialRoute.person(author.accountId)) {
            HStack(spacing: 10) {
                Avatar(
                    name: author.name, kind: author.verified ? .verified : .unverified, size: 36, photo: author.photoOf)
                VStack(alignment: .leading, spacing: 2) {
                    NameWithMark(
                        name: authorName(author), verified: author.verified, markSize: 12, font: .sans(14, black: true))
                    if let detail {
                        Text(verbatim: detail).font(TypeStyle.meta).foregroundStyle(BrandTokens.Colors.mutedFg)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
