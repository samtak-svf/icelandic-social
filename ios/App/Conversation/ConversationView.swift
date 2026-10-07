import PhotosUI
import QuickLook
import SpjallCore
import SwiftUI

/// One conversation (1c): bubbles, own on the right, the composer below, and
/// long press for reply, edit, delete for everyone and reactions. Each bubble
/// is one element for VoiceOver, with the same actions as named actions.
struct ConversationView: View {
    let model: ConversationModel

    @State private var deleting: Item?
    @State private var reacting: Item?
    @State private var preview: URL?
    @Environment(\.scenePhase) private var scenePhase

    private var group: Bool { (model.conversation?.members.count ?? 0) > 1 }

    private var writable: Bool {
        switch model.conversation?.state {
        case .active, .new: true
        case .excluded, .removed, .stale, nil: false
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            if let state = model.conversation?.state { Banner(state: state) }
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
            }
            timeline
            if model.typing { TypingRow(name: group ? nil : model.conversation?.members.first.map(shownName)) }
            if writable { Composer(model: model) }
        }
        .background(BrandTokens.Colors.surface)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) { TitleView(conversation: model.conversation) }
            if writable, let conversation = model.conversation {
                ToolbarItem(placement: .topBarTrailing) { ConversationMenu(conversation: conversation, model: model) }
            }
        }
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
        .task { await model.follow() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { model.paused() }
        }
        .onDisappear { model.paused() }
        .alert(
            "delete_confirm",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            presenting: deleting
        ) { item in
            Button("delete_for_everyone", role: .destructive) { Task { await model.delete(item) } }
            Button("cancel", role: .cancel) {}
        }
        .confirmationDialog(
            "react",
            isPresented: Binding(get: { reacting != nil }, set: { if !$0 { reacting = nil } }),
            presenting: reacting
        ) { item in
            ForEach(emoji, id: \.self) { emoji in
                Button(emoji) { Task { await model.react(item, emoji) } }
            }
        }
    }

    /// Newest at the bottom, where the scroll view starts and stays as items arrive.
    private var timeline: some View {
        ScrollView {
            LazyVStack(spacing: 2) {
                if model.older && !model.items.isEmpty {
                    ProgressView().padding(8).onAppear { Task { await model.loadOlder() } }
                }
                ForEach(rows(model.items)) { row in
                    switch row {
                    case .day(let date): DayLine(date: date)
                    case .card(let item): CardLine(item: item)
                    case .bubble(let item, let first, let readBy):
                        Bubble(
                            item: item, first: first, readBy: readBy, group: group, model: model,
                            onDelete: { deleting = item }, onReact: { reacting = item })
                    }
                }
            }
            .padding(.vertical, 8)
        }
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
    }
}

/// The reactions a long press offers.
let emoji = ["👍", "❤️", "😂", "😮", "😢", "🙏"]

private struct TitleView: View {
    let conversation: Conversation?

    var body: some View {
        if let conversation {
            HStack(spacing: 4) {
                Text(verbatim: title(conversation)).font(.headline).lineLimit(1)
                if conversation.members.count == 1, conversation.members[0].verified { VerifiedMark() }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
        }
    }
}

private struct Banner: View {
    let state: ConversationState

    var body: some View {
        if let text {
            Text(text)
                .foregroundStyle(BrandTokens.Colors.fg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 16)
                .padding(.top, 8)
        }
    }

    private var text: LocalizedStringKey? {
        switch state {
        case .removed: "conversation_removed_banner"
        case .excluded: "conversation_excluded_banner"
        case .stale: "conversation_stale_banner"
        case .new, .active: nil
        }
    }
}

private struct DayLine: View {
    let date: Date

    var body: some View {
        Group {
            if Calendar.current.isDateInToday(date) {
                Text("day_today")
            } else if Calendar.current.isDateInYesterday(date) {
                Text("day_yesterday")
            } else {
                Text(verbatim: date.formatted(date: .abbreviated, time: .omitted))
            }
        }
        .font(.caption)
        .foregroundStyle(BrandTokens.Colors.mutedFg)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .accessibilityAddTraits(.isHeader)
    }
}

private struct CardLine: View {
    let item: Item

    var body: some View {
        Text(verbatim: lastLine(item))
            .font(.footnote)
            .foregroundStyle(BrandTokens.Colors.mutedFg)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 32)
            .padding(.vertical, 8)
    }
}

/// A 1:1 names who types; in a group the frame's sender is not known (0022).
private struct TypingRow: View {
    let name: String?

    var body: some View {
        Group {
            if let name {
                Text(verbatim: localized("typing_indicator", name))
            } else {
                Text("typing_indicator_group")
            }
        }
        .font(.footnote)
        .foregroundStyle(BrandTokens.Colors.mutedFg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
        .accessibilityAddTraits(.updatesFrequently)
    }
}

private struct Composer: View {
    let model: ConversationModel

    @State private var photo: PhotosPickerItem?
    @State private var picking = false
    @State private var importing = false

    private var blank: Bool { model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            switch model.mode {
            case .new: EmptyView()
            case .reply(let item): ModeLine(label: "reply", item: item, onCancel: model.cancelMode)
            case .edit(let item): ModeLine(label: "edit", item: item, onCancel: model.cancelMode)
            }
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    Button("photo", systemImage: "photo") { picking = true }
                    Button("file", systemImage: "doc") { importing = true }
                } label: {
                    Image(systemName: "paperclip").frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel(Text("attach"))
                TextField(
                    "composer_placeholder",
                    text: Binding(get: { model.draft }, set: { model.type($0) }),
                    axis: .vertical
                )
                .lineLimit(1...5)
                .textFieldStyle(.roundedBorder)
                Button {
                    Task { await model.send() }
                } label: {
                    Image(systemName: "paperplane.fill").frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel(Text("send"))
                .disabled(blank)
            }
            .padding(8)
        }
        .photosPicker(isPresented: $picking, selection: $photo, matching: .images)
        .onChange(of: photo) { _, picked in
            guard let picked else { return }
            photo = nil
            Task { await model.attach(Picked(photo: picked)) }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item]) { result in
            if case .success(let file) = result { Task { await model.attach(Picked(file: file)) } }
        }
    }
}

private struct ModeLine: View {
    let label: LocalizedStringKey
    let item: Item
    let onCancel: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption.weight(.semibold))
                Text(verbatim: lastLine(item))
                    .font(.caption)
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                    .lineLimit(1)
            }
            Spacer()
            Button(action: onCancel) {
                Image(systemName: "xmark").frame(minWidth: 44, minHeight: 44)
            }
            .accessibilityLabel(Text("cancel"))
        }
        .padding(.leading, 16)
    }
}
