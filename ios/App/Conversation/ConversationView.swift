import CoreLocation
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
    /// The envelope of the message whose reactions sheet is open (decision 0045).
    @State private var reactionsOf: String?
    @State private var preview: URL?
    /// The conversation's information screen is pushed (decision 0055).
    @State private var info = false
    /// The picker a forward opened (decision 0041).
    @State private var forwarding: PickModel?
    /// Shown for a moment: into how many conversations the last forward went, or that a text was copied
    /// (decision 0046).
    @State private var notice: String?
    /// The bottom of the timeline is in view.
    @State private var atBottom = true
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var group: Bool {
        guard let conversation = model.conversation else { return false }
        return conversation.name != nil || conversation.members.count > 1
    }

    private var writable: Bool { model.writable }

    var body: some View {
        VStack(spacing: 0) {
            TopBar(conversation: model.conversation, model: model, writable: writable, info: $info)
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
        .navigationDestination(isPresented: $info) { ConversationInfoView(model: model).bellInNavigationBar() }
        .onChange(of: model.opened) { _, opened in
            // The information screen above opens what was tapped there.
            guard let opened, !info else { return }
            preview = PreviewCopy.file(opened)
            if preview == nil { model.didOpen() }
        }
        .onChange(of: preview) { old, new in
            guard old != nil, new == nil else { return }
            PreviewCopy.clear()
            model.didOpen()
        }
        .sheet(isPresented: Binding(get: { forwarding != nil }, set: { if !$0 { forwarding = nil } })) {
            if let picker = forwarding {
                PickView(model: picker, title: "forward") { forwarding = nil }
                    .onChange(of: picker.done) { _, done in
                        guard let done else { return }
                        forwarding = nil
                        notice = plural("forward_done", done)
                    }
            }
        }
        .overlay(alignment: .top) {
            if let notice {
                Text(verbatim: notice)
                    .font(.footnote)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.top, 56)
                    // A second notice while one shows starts the moment again.
                    .task(id: notice) {
                        AccessibilityNotification.Announcement(notice).post()
                        try? await Task.sleep(for: .seconds(2))
                        if !Task.isCancelled { self.notice = nil }
                    }
            }
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
                // 2 points between bubbles, as on Android; a new sender's run adds 8 (Bubble).
                LazyVStack(spacing: 2) {
                    if model.older && !model.items.isEmpty {
                        ProgressView().padding(8).onAppear { Task { await model.loadOlder() } }
                    }
                    ForEach(shown) { row in
                        switch row {
                        case .time(let date, _): TimeLine(date: date)
                        case .card(let item): CardLine(item: item, group: group)
                        case .bubble(let item, let first, let last, let readBy):
                            Bubble(
                                item: item, first: first, last: last, readBy: readBy, group: group, model: model,
                                onDelete: { deleting = item }, onReact: { reacting = item },
                                onReactions: { reactionsOf = item.envelopeId },
                                onForward: { forwarding = model.forwarding(item) },
                                onCopy: { notice = localized("copied") })
                        }
                    }
                    Color.clear.frame(height: 1).id(Self.bottom)
                        .onAppear { atBottom = true }
                        .onDisappear { atBottom = false }
                }
                .padding(.vertical, 8)
                // A message the core's events bring, change or take away moves the others aside (decision 0043).
                .animation(Motion.rows(reduceMotion: reduceMotion), value: shown.map(\.id))
            }
            // Who reacted to a message, read from the newest items while it shows (decision 0045).
            .sheet(isPresented: Binding(get: { reactionsOf != nil }, set: { if !$0 { reactionsOf = nil } })) {
                if let item = model.items.first(where: { $0.envelopeId != nil && $0.envelopeId == reactionsOf }) {
                    ReactionsSheet(item: item, others: model.conversation?.members ?? [], model: model)
                }
            }
            .defaultScrollAnchor(.bottom)
            .followsGrowthAtBottom()
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: shown.last?.id) { _, newest in
                guard newest != nil else { return }
                var own = false
                if case .bubble(let item, _, _, _)? = shown.last { own = item.own }
                if own || atBottom {
                    withAnimation(Motion.rows(reduceMotion: reduceMotion)) {
                        proxy.scrollTo(Self.bottom, anchor: .bottom)
                    }
                }
            }
        }
    }

    private static let bottom = "bottom"
}

extension View {
    /// While the bottom is in view it stays there, also when the newest row grows as its photo decodes
    /// (decision 0048). Before iOS 18 the list keeps its offset when a row grows, as it did.
    @ViewBuilder
    fileprivate func followsGrowthAtBottom() -> some View {
        if #available(iOS 18.0, *) {
            defaultScrollAnchor(.bottom, for: .sizeChanges)
        } else {
            self
        }
    }
}

/// The reactions a long press offers.
let emoji = ["👍", "❤️", "😂", "😮", "😢", "🙏"]

private struct Banner: View {
    let conversation: Conversation

    var body: some View {
        if let text {
            Text(text)
                .font(.sans(13))
                .foregroundStyle(BrandTokens.Colors.fg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(BrandTokens.Colors.secondarySubtle, in: RoundedRectangle(cornerRadius: Radii.card))
                .padding(.horizontal, 16)
                .padding(.top, 8)
        }
    }

    private var text: LocalizedStringKey? {
        switch conversation.state {
        case .removed: "conversation_removed_banner"
        case .left: "left_banner"
        case .excluded: "conversation_excluded_banner"
        case .stale: "conversation_stale_banner"
        case .new, .active: conversation.members.isEmpty ? "conversation_alone_banner" : nil
        }
    }
}

/// The time between messages (decision 0045), in the style the day line had.
private struct TimeLine: View {
    let date: Date

    var body: some View {
        SectionLabel(text: timeLine(date))
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
        .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: Radii.bubble))
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
    /// The system camera is open (decision 0047).
    @State private var shooting = false
    /// The phone is finding where it is, then the place to confirm, or why there is none (decision 0059).
    @State private var locator = Locator()
    @State private var finding = false
    @State private var found: CLLocation?
    @State private var unlocated: LocalizedStringKey?
    @FocusState private var focused: Bool
    /// Counts the sends, each one a light tick (decision 0043), as the system's haptics setting allows.
    @State private var sent = 0

    private var blank: Bool { !model.sendable }

    /// The phone has a camera; a simulator has none, and shows no camera button.
    private var camera: Bool { Camera.available }

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            switch model.mode {
            case .new: EmptyView()
            case .reply(let item): ModeLine(label: "reply", item: item, onCancel: model.cancelMode)
            case .edit(let item): ModeLine(label: "edit", item: item, onCancel: model.cancelMode)
            }
            if let attachment = model.attachment {
                PendingStrip(pending: attachment, onRemove: model.removeAttachment)
            }
            if finding {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("location_finding").font(TypeStyle.meta).foregroundStyle(BrandTokens.Colors.mutedFg)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .accessibilityElement(children: .combine)
            }
            HStack(alignment: .bottom, spacing: 0) {
                Spacer().frame(width: 12)
                TextField(
                    model.attachment == nil ? "composer_placeholder" : "caption_placeholder",
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
                    in: RoundedRectangle(cornerRadius: Radii.field)
                )
                .overlay {
                    if focused {
                        RoundedRectangle(cornerRadius: Radii.field).strokeBorder(BrandTokens.Colors.fg, lineWidth: 1.5)
                    }
                }
                .padding(.vertical, 2)
                // The camera and attach while the field is empty, send in their place once it has
                // text or a photo or file waits; replying or editing keeps send (decisions 0043, 0047, 0048).
                ForEach(model.composerButtons(camera: camera), id: \.self) { button in
                    switch button {
                    case .camera:
                        RoundButton(
                            systemImage: "camera", label: "camera", fill: BrandTokens.Colors.muted,
                            tint: BrandTokens.Colors.fg, size: 38
                        ) { shooting = true }
                    case .attach:
                        Menu {
                            Button("photo", systemImage: "photo") { picking = true }
                            Button("file", systemImage: "doc") { importing = true }
                            Button("location", systemImage: "mappin.and.ellipse") { Task { await locate() } }
                        } label: {
                            RoundIcon(
                                systemImage: "plus", fill: BrandTokens.Colors.muted, tint: BrandTokens.Colors.fg,
                                size: 38)
                        }
                        .accessibilityLabel(Text("attach"))
                    case .send:
                        RoundButton(
                            systemImage: "paperplane.fill", label: "send",
                            fill: blank ? BrandTokens.Colors.muted : BrandTokens.Colors.primary,
                            tint: blank ? BrandTokens.Colors.mutedFg : BrandTokens.Colors.primaryFg,
                            size: 40, enabled: !blank
                        ) {
                            sent += 1
                            Task { await model.send() }
                        }
                        .sensoryFeedback(.impact(weight: .light), trigger: sent)
                    }
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
            Task { await model.pick(Picked(photo: picked)) }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item]) { result in
            if case .success(let file) = result { Task { await model.pick(Picked(file: file)) } }
        }
        .fullScreenCover(isPresented: $shooting) {
            Camera { taken in
                shooting = false
                if let taken { Task { await model.pick(Picked(taken: taken)) } }
            }
            .ignoresSafeArea()
        }
        .alert(
            "location_send_title",
            isPresented: Binding(get: { found != nil }, set: { if !$0 { found = nil } }),
            presenting: found
        ) { location in
            let (latitude, longitude, accuracy) =
                (location.coordinate.latitude, location.coordinate.longitude, location.horizontalAccuracy)
            Button("send") {
                Task { await model.sendLocation(latitude: latitude, longitude: longitude, accuracy: accuracy) }
            }
            Button("cancel", role: .cancel) {}
        } message: { location in
            if let line = accuracyLine(wholeMetres(location.horizontalAccuracy)) { Text(verbatim: line) }
        }
        .alert(
            "location",
            isPresented: Binding(get: { unlocated != nil }, set: { if !$0 { unlocated = nil } }),
            presenting: unlocated
        ) { _ in
        } message: { reason in
            Text(reason)
        }
    }

    /// One fresh fix, then a confirmation before anything is sent (decision 0059).
    private func locate() async {
        guard !finding else { return }
        finding = true
        let outcome = await locator.locate()
        finding = false
        switch outcome {
        case .found(let location): found = location
        case .denied: unlocated = "location_denied"
        case .notFound: unlocated = "location_not_found"
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
