import SpjallCore
import SwiftUI

/// The communities tab (decision 0063): this account's communities, a search over every one it may see, and,
/// for a verified account, a new one.
struct CommunitiesView: View {
    let model: CommunitiesModel
    let onOpen: (String) -> Void

    @State private var creating = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(title: localized("tab_communities")) {
                if model.verified {
                    RoundButton(
                        systemImage: "plus", label: "community_create", fill: BrandTokens.Colors.primary,
                        tint: BrandTokens.Colors.primaryFg, size: 34, action: { creating = true })
                }
            }
            CommunitySearch(query: Binding(get: { model.query }, set: { model.query = $0 }))
            if model.busy || model.searching {
                ProgressView().progressViewStyle(.linear)
            }
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if model.searched {
                        if !model.searching && model.found.isEmpty && model.problem == nil {
                            EmptyState(systemImage: "magnifyingglass", text: "communities_none_found")
                        }
                        rows(model.found)
                        if model.next != nil {
                            Color.clear.frame(height: 1).task(id: model.next) { await model.more() }
                        }
                    } else {
                        if !model.mine.isEmpty {
                            SectionLabel(text: localized("communities_mine"))
                                .padding(.horizontal, 20)
                                .padding(.top, 12)
                                .padding(.bottom, 4)
                                .accessibilityAddTraits(.isHeader)
                        }
                        if model.loaded && model.mine.isEmpty && model.problem == nil {
                            EmptyState(systemImage: "person.3", text: "communities_empty")
                        }
                        rows(model.mine)
                    }
                }
                .animation(Motion.rows(reduceMotion: reduceMotion), value: shown)
            }
        }
        .background(BrandTokens.Colors.bg)
        .navigationTitle(Text("tab_communities"))
        .toolbar(.hidden, for: .navigationBar)
        .task { await model.load() }
        .task(id: model.query) { await model.search() }
        .sheet(isPresented: $creating) {
            CreateCommunitySheet(model: model)
        }
        .onChange(of: model.created) { _, id in
            guard let id else { return }
            creating = false
            model.opened()
            onOpen(id)
        }
    }

    /// The ids the list shows, in order: what its animation follows.
    private var shown: [String] {
        (model.searched ? model.found : model.mine).map(\.communityId)
    }

    private func rows(_ communities: [Community]) -> some View {
        ForEach(communities, id: \.communityId) { community in
            Button {
                onOpen(community.communityId)
            } label: {
                CommunityRow(community: community)
            }
            .buttonStyle(.plain)
        }
    }
}

/// One community: its name, its audience and members, and the start of its description.
private struct CommunityRow: View {
    let community: Community

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: community.audience == .open ? "person.3" : "person.3.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .frame(width: 46, height: 46)
                    .background(BrandTokens.Colors.secondarySubtle, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(verbatim: community.name)
                        .font(.sans(14.5, black: true))
                        .foregroundStyle(BrandTokens.Colors.fg)
                        .lineLimit(1)
                    Text(verbatim: audienceLine(community))
                        .font(TypeStyle.meta)
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                    if !community.description.isEmpty {
                        Text(verbatim: community.description)
                            .font(.sans(13))
                            .foregroundStyle(BrandTokens.Colors.mutedFg)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            Hairline().padding(.leading, 78)
        }
        .frame(minHeight: 64)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// The search over every community this account may see.
private struct CommunitySearch: View {
    @Binding var query: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(BrandTokens.Colors.mutedFg)
                .accessibilityHidden(true)
            TextField(text: $query, prompt: Text("communities_find")) {
                Text("communities_find")
            }
            .autocorrectionDisabled()
            .submitLabel(.search)
            .onChange(of: query) { _, text in
                if text.count > CommunitiesModel.nameLimit { query = String(text.prefix(CommunitiesModel.nameLimit)) }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(BrandTokens.Colors.surface, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(BrandTokens.Colors.border))
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}

/// A new community: its name, a description, and whether it is open or private, each with what that means.
private struct CreateCommunitySheet: View {
    let model: CommunitiesModel

    @State private var name = ""
    @State private var description = ""
    @State private var audience = CommunityAudience.open
    @Environment(\.dismiss) private var dismiss

    private var ready: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.busy
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("community_name", text: $name)
                        .onChange(of: name) { _, text in
                            if text.count > CommunitiesModel.nameLimit {
                                name = String(text.prefix(CommunitiesModel.nameLimit))
                            }
                        }
                    TextField("community_description", text: $description, axis: .vertical)
                        .lineLimit(2...6)
                        .onChange(of: description) { _, text in
                            if text.count > CommunitiesModel.descriptionLimit {
                                description = String(text.prefix(CommunitiesModel.descriptionLimit))
                            }
                        }
                }
                Section {
                    audienceRow(.open, label: "community_open", hint: "community_open_hint")
                    audienceRow(.private, label: "community_private", hint: "community_private_hint")
                }
                if let problem = model.problem {
                    Section {
                        ProblemCard(problem: problem) { Task { await model.retry() } }
                    }
                }
                Section {
                    Button {
                        Task { await model.create(name: name, description: description, audience: audience) }
                    } label: {
                        Text("community_create").frame(maxWidth: .infinity)
                    }
                    .disabled(!ready)
                }
            }
            .navigationTitle(Text("community_create"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Text("cancel")
                    }
                }
            }
        }
    }

    private func audienceRow(_ value: CommunityAudience, label: LocalizedStringKey, hint: LocalizedStringKey)
        -> some View
    {
        Button {
            audience = value
        } label: {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(label).font(.sans(14.5, black: true)).foregroundStyle(BrandTokens.Colors.fg)
                    Text(hint).font(.sans(13)).foregroundStyle(BrandTokens.Colors.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Image(systemName: audience == value ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(audience == value ? BrandTokens.Colors.primary : BrandTokens.Colors.mutedFg)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(audience == value ? [.isButton, .isSelected] : .isButton)
    }
}
