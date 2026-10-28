import PhotosUI
import SpjallCore
import SwiftUI

/// A conversation's information (decision 0055): who it is with, each setting with its state on its row,
/// and the photos and files sent in it, read from this device. It opens from the title and from the menu on
/// the conversation's own model, and goes back by itself once the conversation is no longer open.
struct ConversationInfoView: View {
    let model: ConversationModel

    @State private var timing = false
    @State private var blocking = false
    @State private var leaving = false
    @State private var renaming = false
    @State private var draftName = ""
    @State private var removing: Person?
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var removingPhoto = false
    @State private var adding: PeopleModel?
    @State private var preview: URL?
    @Environment(\.dismiss) private var dismiss

    private var other: Person? {
        guard let conversation = model.conversation, conversation.name == nil, conversation.members.count == 1 else {
            return nil
        }
        return conversation.members[0]
    }

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 3)

    var body: some View {
        ScrollView {
            if let conversation = model.conversation {
                VStack(spacing: 0) {
                    who(conversation)
                    Divider().overlay(BrandTokens.Colors.border).padding(.vertical, 8)
                    settings(conversation)
                    Divider().overlay(BrandTokens.Colors.border).padding(.top, 8)
                    shared
                }
            }
        }
        .background(BrandTokens.Colors.bg)
        .navigationTitle(Text("conversation_info"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .safeAreaInset(edge: .top) {
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
            }
        }
        .task { await model.loadShared() }
        .onChange(of: model.writable) { _, writable in if !writable { dismiss() } }
        .quickLookPreview($preview)
        .onChange(of: model.opened) { _, opened in
            guard let opened else { return }
            preview = PreviewCopy.file(opened)
            if preview == nil { model.didOpen() }
        }
        .onChange(of: preview) { old, new in
            guard old != nil, new == nil else { return }
            PreviewCopy.clear()
            model.didOpen()
        }
        .sheet(isPresented: $timing) {
            TimerSheet(current: model.conversation?.timer) { seconds in
                timing = false
                if seconds != model.conversation?.timer { Task { await model.timer(seconds) } }
            }
            .presentationDetents([.medium])
        }
        .alert(
            Text(verbatim: other.map { localized("block_confirm", shownName($0)) } ?? ""),
            isPresented: $blocking
        ) {
            Button("block", role: .destructive) { Task { await model.block() } }
            Button("cancel", role: .cancel) {}
        }
        .alert(
            Text("leave_group_confirm"),
            isPresented: $leaving
        ) {
            Button("leave_group", role: .destructive) { Task { await model.leave() } }
            Button("cancel", role: .cancel) {}
        }
        .alert(
            Text(verbatim: removing.map { localized("remove_member_confirm", shownName($0)) } ?? ""),
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })
        ) {
            Button("remove_member", role: .destructive) {
                if let account = removing?.account {
                    removing = nil
                    Task { await model.remove(account) }
                }
            }
            Button("cancel", role: .cancel) { removing = nil }
        }
        .onChange(of: pickedPhoto) { _, item in
            guard let item else { return }
            pickedPhoto = nil
            let pick = Picked(photo: item)
            Task { await model.setGroupPhoto { try await masterFile(pick) } }
        }
        .confirmationDialog("group_photo_remove_confirm", isPresented: $removingPhoto, titleVisibility: .visible) {
            Button("group_photo_remove", role: .destructive) { Task { await model.clearGroupPhoto() } }
            Button("cancel", role: .cancel) {}
        }
        .alert(Text("group_name_title"), isPresented: $renaming) {
            TextField(localized("group_name_hint"), text: $draftName)
            Button("save") {
                let next = String(draftName.prefix(64)).trimmingCharacters(in: .whitespacesAndNewlines)
                Task { await model.rename(next.isEmpty ? nil : next) }
            }
            if model.conversation?.name != nil {
                Button("group_name_remove", role: .destructive) {
                    Task { await model.rename(nil) }
                }
            }
            Button("cancel", role: .cancel) {}
        }
        .sheet(isPresented: Binding(get: { adding != nil }, set: { if !$0 { adding = nil } })) {
            if let picker = adding {
                NavigationStack {
                    PeopleView(model: picker, onInvite: {}).withoutBell()
                }
                .onChange(of: picker.opened) { _, opened in
                    guard opened != nil else { return }
                    adding = nil
                    Task { await model.load() }
                }
            }
        }
    }

    /// The other person, large, with their mark; or a group's name and everyone in it.
    private func who(_ conversation: Conversation) -> some View {
        let one = (conversation.name == nil && conversation.members.count == 1) ? conversation.members[0] : nil
        return VStack(spacing: 12) {
            Avatar(
                name: one?.name ?? title(conversation), kind: avatarKind(conversation), size: 96,
                photo: photoOf(conversation)
            )
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("group_photo_alt"))
            .accessibilityHidden(conversation.photo == nil || one != nil)
            HStack(spacing: 6) {
                Text(verbatim: one.map(shownName) ?? title(conversation))
                    .font(.title2.weight(.bold))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(BrandTokens.Colors.fg)
                if one?.verified == true { VerifiedMark() }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            .padding(.horizontal, 16)
            if one == nil {
                HStack(spacing: 16) {
                    Button {
                        adding = PeopleModel(
                            account: model.account,
                            live: model.live,
                            targetConversation: conversation.id,
                            existing: Set(conversation.members.map(\.account))
                        )
                    } label: {
                        Label("add_people", systemImage: "person.badge.plus")
                    }
                    .buttonStyle(.bordered)
                    Button {
                        draftName = conversation.name ?? ""
                        renaming = true
                    } label: {
                        Label("group_name", systemImage: "pencil")
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.top, 4)
                groupPhotoControls(conversation)
                members(conversation)
            }
        }
        .padding(.top, 24)
        .padding(.bottom, 8)
    }

    /// Choose or change the group's photo, remove it, and who sees it (decision 0094). Only for a group.
    private func groupPhotoControls(_ conversation: Conversation) -> some View {
        VStack(spacing: 8) {
            HStack(spacing: 16) {
                PhotosPicker(selection: $pickedPhoto, matching: .images) {
                    Label(
                        conversation.photo == nil ? "group_photo_choose" : "group_photo_change",
                        systemImage: "photo")
                }
                .buttonStyle(.bordered)
                if conversation.photo != nil {
                    Button(role: .destructive) {
                        removingPhoto = true
                    } label: {
                        Label("group_photo_remove", systemImage: "trash")
                    }
                    .buttonStyle(.bordered)
                }
            }
            Text("group_photo_seen_by_members")
                .font(.footnote)
                .foregroundStyle(BrandTokens.Colors.fg)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
        }
    }

    private func members(_ conversation: Conversation) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionLabel(text: plural("group_member_count", conversation.members.count))
                .padding(.top, 8)
                .padding(.bottom, 4)
            ForEach(conversation.members, id: \.account) { person in
                HStack(spacing: 12) {
                    Avatar(person: person, size: 36)
                    Text(verbatim: shownName(person)).foregroundStyle(BrandTokens.Colors.fg)
                    if person.verified { VerifiedMark() }
                    Spacer(minLength: 0)
                    Menu {
                        Button("remove_member", role: .destructive) {
                            removing = person
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .foregroundStyle(BrandTokens.Colors.mutedFg)
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel(Text("more_options"))
                }
                .frame(minHeight: 48)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
    }

    /// The timer and mute rows say what they are set to; block or leave is last, in red.
    private func settings(_ conversation: Conversation) -> some View {
        let muted = conversation.mute != .off
        return VStack(spacing: 0) {
            Button {
                timing = true
            } label: {
                InfoRow(label: localized("disappearing_messages"), value: timerLine(conversation.timer))
            }
            if muted {
                Button {
                    Task { await model.unmute() }
                } label: {
                    InfoRow(label: localized("unmute"), value: muteLine(conversation.mute))
                }
            } else {
                Menu {
                    Button("mute_hour") { Task { await model.mute(.hour) } }
                    Button("mute_eight_hours") { Task { await model.mute(.eightHours) } }
                    Button("mute_always") { Task { await model.mute(.always) } }
                } label: {
                    InfoRow(label: localized("mute"), value: muteLine(conversation.mute))
                }
            }
            if other != nil {
                Button(role: .destructive) {
                    blocking = true
                } label: {
                    InfoRow(label: localized("block"), color: BrandTokens.Colors.danger)
                }
            } else {
                Button(role: .destructive) {
                    leaving = true
                } label: {
                    InfoRow(label: localized("leave_group"), color: BrandTokens.Colors.danger)
                }
            }
        }
        .buttonStyle(.plain)
    }

    /// The photos as a grid and the files as rows, each newest first.
    @ViewBuilder
    private var shared: some View {
        SectionLabel(text: localized("shared_media"))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 8)
        if let shared = model.shared, shared.loaded {
            if shared.items.isEmpty {
                Text("shared_media_empty")
                    .font(.subheadline)
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                    .multilineTextAlignment(.center)
                    .padding(24)
            } else {
                let photos = shared.items.filter(\.photo)
                LazyVGrid(columns: columns, spacing: 2) {
                    ForEach(photos, id: \.seq) { item in
                        SharedPhoto(item: item, model: model)
                            .onAppear { if item.seq == photos.last?.seq { Task { await model.moreShared() } } }
                    }
                }
                LazyVStack(spacing: 0) {
                    ForEach(shared.items.filter { !$0.photo }, id: \.seq) { item in
                        SharedFile(item: item, model: model)
                            .onAppear { if item.seq == shared.items.last?.seq { Task { await model.moreShared() } } }
                    }
                }
            }
        }
    }
}

/// Whether the conversation is muted, and until when (decisions 0042, 0055).
func muteLine(_ mute: Mute) -> String {
    switch mute {
    case .off: localized("mute_off")
    case .until(let at): localized("muted_until", clockTime(at))
    case .always: localized("muted_always")
    }
}

private struct InfoRow: View {
    let label: String
    var value: String?
    var color = BrandTokens.Colors.fg

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: label).foregroundStyle(color)
            if let value {
                Text(verbatim: value).font(.footnote).foregroundStyle(BrandTokens.Colors.mutedFg)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
        .padding(.horizontal, 16)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// A photo of the grid: square, fetched when it first shows, opened by a tap.
private struct SharedPhoto: View {
    let item: Item
    let model: ConversationModel

    @State private var image: UIImage?
    @Environment(\.displayScale) private var scale

    private var path: String? {
        guard let seq = item.seq, case .ready(let path) = model.media[seq] else { return nil }
        return path
    }

    var body: some View {
        Button {
            Task { await model.open(item) }
        } label: {
            Rectangle()
                .fill(BrandTokens.Colors.muted)
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    if let image {
                        Image(uiImage: image).resizable().scaledToFill()
                    } else if item.seq.flatMap({ model.media[$0] }) == .loading {
                        ProgressView()
                    }
                }
                .clipped()
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: lastLine(item)))
        .accessibilityAddTraits(.isImage)
        .task(id: item.seq) { if item.seq.flatMap({ model.media[$0] }) == nil { await model.fetch(item) } }
        .task(id: path) {
            guard let path else { return }
            let longest = 160 * scale
            image = await Task.detached(priority: .userInitiated) { decodePhoto(path, longest: longest) }.value
        }
    }
}

/// A file of the list: its name and size, opened by a tap.
private struct SharedFile: View {
    let item: Item
    let model: ConversationModel

    var body: some View {
        if case .media(_, let size, _, let name) = item.content {
            Button {
                Task { await model.open(item) }
            } label: {
                HStack(spacing: 12) {
                    if item.seq.flatMap({ model.media[$0] }) == .loading {
                        ProgressView()
                    } else {
                        Image(systemName: "doc").accessibilityHidden(true)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: name ?? lastLine(item)).foregroundStyle(BrandTokens.Colors.fg)
                        Text(verbatim: ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
                            .font(.footnote)
                            .foregroundStyle(BrandTokens.Colors.mutedFg)
                    }
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 56)
                .padding(.horizontal, 16)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(BrandTokens.Colors.mutedFg)
        }
    }
}

extension Item {
    /// A photo, as against any other file.
    var photo: Bool {
        if case .media(let mime, _, _, _) = content { return mime.hasPrefix("image/") }
        return false
    }
}
