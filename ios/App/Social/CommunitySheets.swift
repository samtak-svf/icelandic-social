import SpjallCore
import SwiftUI

// The two screens a community's header opens (decision 0079): `Um samfélagið`, which every reader has, and
// `Stjórna`, which its moderators and its owner have. A member's tools are nowhere else: not above the composer,
// not on a post card, not behind a long press.

/// `Um samfélagið` (decision 0079): the whole description, the notice that a community's content is hosted and not
/// end-to-end encrypted (decisions 0060, 0063), and the member list with each member's role. It is what a plain
/// member has instead of `Stjórna`.
struct CommunityInfoSheet: View {
    let model: CommunityModel

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                if let community = model.community, !community.description.isEmpty {
                    Section {
                        Text(verbatim: community.description)
                            .font(.sans(14))
                            .foregroundStyle(BrandTokens.Colors.proseBody)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Section {
                    Text("community_not_encrypted_notice")
                        .font(.sans(13.5))
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Section("community_members_title") {
                    if !model.membersLoaded {
                        ProgressView()
                    }
                    ForEach(model.members, id: \.accountId) { member in
                        CommunityMemberRow(member: member)
                    }
                }
            }
            .navigationTitle(Text("community_info"))
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
            .safeAreaInset(edge: .top) {
                if let problem = model.problem {
                    ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
                }
            }
            .task { await model.loadMembers() }
        }
        .presentationDetents([.medium, .large])
    }
}

/// One account in a community's member list: its avatar, name and the role it holds there (decision 0079).
struct CommunityMemberRow: View {
    let member: CommunityMember

    var body: some View {
        HStack(spacing: 12) {
            Avatar(name: member.name, kind: member.verified ? .verified : .unverified, size: 34, photo: member.photoOf)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(verbatim: member.name ?? localized("person_unnamed"))
                        .font(.sans(14.5, black: true))
                        .foregroundStyle(BrandTokens.Colors.fg)
                        .lineLimit(1)
                    if member.verified { VerifiedMark(size: 12) }
                }
                Text(verbatim: roleLabel(member.role))
                    .font(TypeStyle.meta)
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
            }
            Spacer(minLength: 8)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}

/// `Stjórna` (decision 0079): the tools a moderator and the owner have, in one list, and its label carries the work
/// that waits. The owner also changes the community and deletes it; nowhere else offers either.
struct CommunityManageSheet: View {
    let model: CommunityModel
    let social: Social

    @Environment(\.dismiss) private var dismiss
    /// The owner is being asked to confirm the deletion of the community.
    @State private var deleting = false

    var body: some View {
        NavigationStack {
            Form {
                if let problem = model.problem {
                    Section {
                        ProblemCard(problem: problem) { Task { await model.retry() } }
                    }
                }
                Section {
                    NavigationLink(value: ManageRoute.reports) {
                        row("moderation_queue", systemImage: "tray", count: model.openReports)
                    }
                    NavigationLink(value: ManageRoute.requests) {
                        row(
                            "join_requests_title", systemImage: "person.crop.circle.badge.questionmark",
                            count: model.pendingRequests)
                    }
                    NavigationLink(value: ManageRoute.members) {
                        row("community_members_title", systemImage: "person.3", count: nil)
                    }
                    NavigationLink(value: ManageRoute.log) {
                        row("moderation_log_title", systemImage: "list.bullet.rectangle", count: nil)
                    }
                }
                if model.owns {
                    Section {
                        NavigationLink(value: ManageRoute.edit) {
                            row("community_edit", systemImage: "pencil", count: nil)
                        }
                    }
                    Section {
                        Button(role: .destructive) {
                            deleting = true
                        } label: {
                            Text("community_delete")
                        }
                    }
                }
            }
            .navigationTitle(Text("community_manage"))
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
            .navigationDestination(for: ManageRoute.self) { route in
                switch route {
                case .reports: ManageReports(id: model.communityId, social: social)
                case .requests: ManageRequests(id: model.communityId, social: social)
                case .members: CommunityMembersView(model: model)
                case .log: ModerationLogView(model: model)
                case .edit: EditCommunityView(model: model)
                }
            }
            .alert(
                Text(verbatim: localized("community_delete_confirm", model.community?.name ?? "")),
                isPresented: $deleting
            ) {
                Button("community_delete", role: .destructive) { Task { await model.deleteCommunity() } }
                Button("cancel", role: .cancel) {}
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// One tool: what it is, and how many things wait in it when any do.
    private func row(_ title: LocalizedStringKey, systemImage: String, count: Int?) -> some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(BrandTokens.Colors.primary)
                .frame(width: 24)
                .accessibilityHidden(true)
            Text(title)
                .font(.sans(14.5))
                .foregroundStyle(BrandTokens.Colors.fg)
            Spacer(minLength: 8)
            if let count, count > 0 { CountBadge(count: count) }
        }
        .frame(minHeight: 44)
    }
}

/// Where the tools lead, inside the sheet's own stack (decision 0079).
private enum ManageRoute: Hashable {
    case reports, requests, members, log, edit
}

/// A report queue, with a model of its own each time it opens.
private struct ManageReports: View {
    @State private var model: ReportsModel

    init(id: String, social: Social) {
        _model = State(initialValue: ReportsModel(social: social, communityId: id))
    }

    var body: some View {
        ReportsView(model: model)
    }
}

/// The join requests waiting for a moderator.
private struct ManageRequests: View {
    @State private var model: JoinRequestsModel

    init(id: String, social: Social) {
        _model = State(initialValue: JoinRequestsModel(social: social, communityId: id))
    }

    var body: some View {
        JoinRequestsView(model: model)
    }
}

/// `Meðlimir og hlutverk` (decision 0079): every member with the role it holds. The owner alone names a moderator
/// and removes one; a moderator reads the list and changes nothing.
private struct CommunityMembersView: View {
    let model: CommunityModel

    var body: some View {
        Form {
            Section {
                if !model.membersLoaded {
                    ProgressView()
                }
                ForEach(model.members, id: \.accountId) { member in
                    memberRow(member)
                }
            }
        }
        .navigationTitle(Text("community_members_title"))
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .top) {
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
            }
        }
        .task { await model.loadMembers() }
    }

    @ViewBuilder private func memberRow(_ member: CommunityMember) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            CommunityMemberRow(member: member)
            if model.owns, member.role != .owner {
                let moderator = member.role == .moderator
                let label: LocalizedStringKey =
                    moderator ? "community_remove_moderator" : "community_make_moderator"
                Button {
                    Task { await model.setRole(member.accountId, moderator ? .member : .moderator) }
                } label: {
                    Text(label)
                        .font(.sans(12.5, black: true))
                }
                .disabled(model.busy)
            }
        }
    }
}

/// `Aðgerðaskrá` (decisions 0066, 0079): what the community's moderators did, newest first, with the reason each
/// gave. It is a reading of the append-only log: nothing here edits or deletes an entry.
private struct ModerationLogView: View {
    let model: CommunityModel

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if model.logLoaded && model.log.isEmpty && model.problem == nil {
                    EmptyState(systemImage: "list.bullet.rectangle", text: "moderation_log_empty")
                }
                ForEach(model.log, id: \.entryId) { entry in
                    LogCard(entry: entry)
                }
                if model.logNext != nil {
                    Color.clear.frame(height: 1).task(id: model.logNext) { await model.moreLog() }
                }
            }
            .padding(16)
        }
        .background(BrandTokens.Colors.bg)
        .navigationTitle(Text("moderation_log_title"))
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .top) {
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
            }
        }
        .task { await model.loadLog() }
    }
}

/// One entry of the log: what was done, who did it and when, and the reason they gave.
private struct LogCard: View {
    let entry: ModerationLogEntry

    var body: some View {
        Panel {
            VStack(alignment: .leading, spacing: 6) {
                // An action a later server adds has no words yet: the entry still names who did it and when.
                if let action = logActionLabel(entry.action) {
                    Text(verbatim: action)
                        .font(.sans(14, black: true))
                        .foregroundStyle(BrandTokens.Colors.fg)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(verbatim: "\(authorName(entry.actor)) · \(postedAt(entry.createdAt))")
                    .font(TypeStyle.meta)
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                if !entry.reason.isEmpty {
                    Text(verbatim: entry.reason)
                        .font(.sans(13.5))
                        .italic()
                        .foregroundStyle(BrandTokens.Colors.proseBody)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(14)
        }
    }
}

/// `Breyta samfélagi` (decision 0079): the name, the description and the audience, which its owner alone sends. A
/// private community never becomes open again, so it offers its own audience alone (decision 0063).
private struct EditCommunityView: View {
    let model: CommunityModel

    @State private var name: String
    @State private var description: String
    @State private var audience: CommunityAudience
    @State private var framing: FrameRequest?
    @Environment(\.dismiss) private var dismiss

    init(model: CommunityModel) {
        self.model = model
        _name = State(initialValue: model.community?.name ?? "")
        _description = State(initialValue: model.community?.description ?? "")
        _audience = State(initialValue: model.community?.audience ?? .open)
    }

    /// The community is private already, which it stays.
    private var locked: Bool { model.community?.audience == .private }

    private var ready: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.busy
    }

    var body: some View {
        Form {
            Section {
                CommunityTextFields(name: $name, description: $description)
            }
            Section {
                CommunityPictureFields(
                    hasPicture: model.community?.photo != nil, hasCover: model.community?.cover != nil,
                    onPicture: { pick in Task { await frame(pick, cover: false) } },
                    onCover: { pick in Task { await frame(pick, cover: true) } },
                    onRemovePicture: { Task { await model.removePicture() } },
                    onRemoveCover: { Task { await model.removeCover() } },
                    onFramePicture: { Task { await reframe(cover: false) } },
                    onFrameCover: { Task { await reframe(cover: true) } },
                    disabled: model.busy)
            }
            Section {
                CommunityAudiencePicker(audience: $audience, locked: locked)
            }
            if let problem = model.problem {
                Section {
                    ProblemCard(problem: problem) { Task { await model.retry() } }
                }
            }
            Section {
                Button {
                    Task {
                        if await model.update(name: name, description: description, audience: audience) {
                            dismiss()
                        }
                    }
                } label: {
                    Text("save").frame(maxWidth: .infinity)
                }
                .disabled(!ready)
            }
        }
        .navigationTitle(Text("community_edit"))
        .navigationBarTitleDisplayMode(.inline)
        .frameSheet($framing)
    }

    /// A new pick goes to the crop sheet first; Save uploads the master, then the framing (decision 0086). The
    /// upload makes its own master from the pick, so trying again after a failure still has one.
    private func frame(_ pick: Picked, cover: Bool) async {
        let kind: FrameKind = cover ? .cover : .photo
        guard let master = try? await masterFile(pick) else {
            // Not an image the sheet can open: the upload reports it as it always did.
            if cover { await model.setCover { try await masterFile(pick) } }
            else { await model.setPicture { try await masterFile(pick) } }
            return
        }
        framing = FrameRequest(kind: kind, master: master, start: nil) { framed in
            try? FileManager.default.removeItem(at: master)
            guard let framed else { return }
            Task {
                if cover { await model.setCover({ try await masterFile(pick) }, framing: framed) }
                else { await model.setPicture({ try await masterFile(pick) }, framing: framed) }
            }
        }
    }

    /// The image already set, framed again from the master the server kept.
    private func reframe(cover: Bool) async {
        guard let master = await model.master(cover: cover) else { return }
        framing = FrameRequest(kind: cover ? .cover : .photo, master: master, start: model.framing(cover: cover)) {
            framed in
            try? FileManager.default.removeItem(at: master)
            guard let framed else { return }
            Task { await model.reframe(cover: cover, framed) }
        }
    }
}
