import PhotosUI
import QuickLook
import SpjallCore
import SwiftUI

/// One conversation (1c): bubbles, own on the right, the composer below, and
/// long press for reply, edit, delete for everyone and reactions. Each bubble
/// is one element for VoiceOver, with the same actions as named actions.
struct ConversationView: View {
    let model: ConversationModel
    /// Opens a shared post's replies.
    var onPost: (String) -> Void = { _ in }

    @State private var deleting: Item?
    @State private var reacting: Item?
    @State private var preview: URL?
    /// The bottom of the timeline is in view.
    @State private var atBottom = true
    @Environment(\.scenePhase) private var scenePhase

    private var group: Bool { (model.conversation?.members.count ?? 0) > 1 }

    /// No one else is here once a block ends a 1:1: nothing to send to.
    private var writable: Bool {
        guard let conversation = model.conversation, !conversation.members.isEmpty else { return false }
        switch conversation.state {
        case .active, .new: return true
        case .excluded, .removed, .stale: return false
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            TopBar(conversation: model.conversation, model: model, writable: writable)
            if let conversation = model.conversation { Banner(conversation: conversation) }
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
            }
            timeline
            if model.typing { TypingRow(name: group ? nil : model.conversation?.members.first.map(shownName)) }
            if writable { Composer(model: model) }
        }
        .background(BrandTokens.Colors.surface)
        .toolbar(.hidden, for: .navigationBar)
        .background { SwipeBack().frame(width: 0, height: 0) }
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

    /// Newest at the bottom, where the scroll view starts. A new item comes
    /// into view when it is own, or when the bottom was in view; someone
    /// reading further up stays where they are.
    private var timeline: some View {
        let shown = rows(model.items)
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    if model.older && !model.items.isEmpty {
                        ProgressView().padding(8).onAppear { Task { await model.loadOlder() } }
                    }
                    ForEach(shown) { row in
                        switch row {
                        case .day(let date): DayLine(date: date)
                        case .card(let item): CardLine(item: item, group: group)
                        case .bubble(let item, let first, let last, let readBy):
                            Bubble(
                                item: item, first: first, last: last, readBy: readBy, group: group, model: model,
                                onDelete: { deleting = item }, onReact: { reacting = item }, onPost: onPost)
                        }
                    }
                    Color.clear.frame(height: 1).id(Self.bottom)
                        .onAppear { atBottom = true }
                        .onDisappear { atBottom = false }
                }
                .padding(.vertical, 8)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: shown.last?.id) { _, newest in
                guard newest != nil else { return }
                var own = false
                if case .bubble(let item, _, _, _)? = shown.last { own = item.own }
                if own || atBottom { withAnimation { proxy.scrollTo(Self.bottom, anchor: .bottom) } }
            }
        }
    }

    private static let bottom = "bottom"
}

/// The reactions a long press offers.
let emoji = ["👍", "❤️", "😂", "😮", "😢", "🙏"]

/// The cream bar across the top: back, who this is with and whether Kenni
/// verified them, and the conversation's menu.
private struct TopBar: View {
    let conversation: Conversation?
    let model: ConversationModel
    let writable: Bool

    @Environment(\.dismiss) private var dismiss

    private var verified: Bool {
        guard let conversation, conversation.members.count == 1 else { return false }
        return conversation.members[0].verified
    }

    var body: some View {
        HStack(spacing: 10) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("back"))
            if let conversation {
                let group = conversation.members.count > 1
                Avatar(
                    name: group ? title(conversation) : conversation.members.first?.name,
                    kind: avatarKind(conversation), size: 38)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 5) {
                        Text(verbatim: title(conversation))
                            .font(.sans(15.5, black: true, relativeTo: .headline))
                            .foregroundStyle(BrandTokens.Colors.fg)
                            .lineLimit(1)
                        if verified { VerifiedMark() }
                    }
                    if verified {
                        // The mark already says it to VoiceOver.
                        Text("verified_short")
                            .font(.sans(11, relativeTo: .caption))
                            .foregroundStyle(BrandTokens.Colors.mutedFg)
                            .accessibilityHidden(true)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: 0)
            if writable, let conversation {
                ConversationMenu(conversation: conversation, model: model)
            }
        }
        .padding(.leading, 4)
        .padding(.trailing, 8)
        .padding(.vertical, 6)
        .background(BrandTokens.Colors.bg.ignoresSafeArea(edges: .top))
        .overlay(alignment: .bottom) {
            Rectangle().fill(BrandTokens.Colors.border).frame(height: 1)
        }
    }
}

private struct Banner: View {
    let conversation: Conversation

    var body: some View {
        if let text {
            Text(text)
                .font(.sans(13))
                .foregroundStyle(BrandTokens.Colors.fg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(BrandTokens.Colors.secondarySubtle, in: RoundedRectangle(cornerRadius: 14))
                .padding(.horizontal, 16)
                .padding(.top, 8)
        }
    }

    private var text: LocalizedStringKey? {
        switch conversation.state {
        case .removed: "conversation_removed_banner"
        case .excluded: "conversation_excluded_banner"
        case .stale: "conversation_stale_banner"
        case .new, .active: conversation.members.isEmpty ? "conversation_alone_banner" : nil
        }
    }
}

private struct DayLine: View {
    let date: Date

    var body: some View {
        SectionLabel(text: dayHeading(date))
            .frame(maxWidth: .infinity)
            .padding(.top, 16)
            .padding(.bottom, 6)
            .accessibilityAddTraits(.isHeader)
    }
}

private struct CardLine: View {
    let item: Item
    let group: Bool

    var body: some View {
        Text(verbatim: lastLine(item, group: group))
            .font(.sans(12, relativeTo: .footnote))
            .foregroundStyle(BrandTokens.Colors.mutedFg)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 32)
            .padding(.vertical, 8)
    }
}

/// Three dots in a grey bubble. A 1:1 names who types to VoiceOver; in a
/// group the frame's sender is not known (0022).
private struct TypingRow: View {
    let name: String?

    private var label: String {
        name.map { localized("typing_indicator", $0) } ?? localized("typing_indicator_group")
    }

    var body: some View {
        HStack(spacing: 4) {
            ForEach([1, 0.7, 0.4], id: \.self) { alpha in
                Circle()
                    .fill(BrandTokens.Colors.mutedFg.opacity(alpha))
                    .frame(width: 6, height: 6)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: 18))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(.updatesFrequently)
    }
}

private struct Composer: View {
    let model: ConversationModel

    @State private var photo: PhotosPickerItem?
    @State private var picking = false
    @State private var importing = false
    @FocusState private var focused: Bool

    private var blank: Bool { model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            switch model.mode {
            case .new: EmptyView()
            case .reply(let item): ModeLine(label: "reply", item: item, onCancel: model.cancelMode)
            case .edit(let item): ModeLine(label: "edit", item: item, onCancel: model.cancelMode)
            }
            HStack(alignment: .bottom, spacing: 0) {
                // Attaching starts a message of its own, so not while replying or editing.
                if model.mode == .new {
                    Menu {
                        Button("photo", systemImage: "photo") { picking = true }
                        Button("file", systemImage: "doc") { importing = true }
                    } label: {
                        RoundIcon(
                            systemImage: "plus", fill: BrandTokens.Colors.muted, tint: BrandTokens.Colors.fg, size: 38)
                    }
                    .accessibilityLabel(Text("attach"))
                } else {
                    Spacer().frame(width: 12)
                }
                TextField(
                    "composer_placeholder",
                    text: Binding(get: { model.draft }, set: { model.type($0) }),
                    axis: .vertical
                )
                .font(.sans(14))
                .lineLimit(1...5)
                .focused($focused)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .frame(minHeight: 40)
                .background(
                    focused ? BrandTokens.Colors.surface : BrandTokens.Colors.muted,
                    in: RoundedRectangle(cornerRadius: 20)
                )
                .overlay {
                    if focused {
                        RoundedRectangle(cornerRadius: 20).strokeBorder(BrandTokens.Colors.fg, lineWidth: 1.5)
                    }
                }
                .padding(.vertical, 2)
                RoundButton(
                    systemImage: "paperplane.fill", label: "send",
                    fill: blank ? BrandTokens.Colors.muted : BrandTokens.Colors.primary,
                    tint: blank ? BrandTokens.Colors.mutedFg : BrandTokens.Colors.primaryFg,
                    size: 40, enabled: !blank
                ) {
                    Task { await model.send() }
                }
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 6)
        }
        .background(BrandTokens.Colors.surface)
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
                Text(label).font(TypeStyle.meta).foregroundStyle(BrandTokens.Colors.primary)
                Text(verbatim: lastLine(item))
                    .font(.sans(12, relativeTo: .caption))
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
