import SpjallCore
import SwiftUI

/// The conversation list in pick mode: each row a checkbox, and one send for all the picked ones.
/// A forward (decision 0041) and a shared post (decision 0040) differ only in `title` and what the
/// model does per conversation. What is being sent shows at the top, and a search narrows the list by name
/// (decision 0043).
struct PickView: View {
    let model: PickModel
    let title: LocalizedStringKey
    let onClose: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
            List {
                if let outgoing = model.outgoing {
                    OutgoingPreview(outgoing: outgoing).listRowSeparator(.hidden)
                }
                if model.sending {
                    ProgressView().progressViewStyle(.linear).listRowSeparator(.hidden)
                }
                if let problem = model.problem {
                    ProblemCard(problem: problem) { Task { await model.retry() } }
                        .listRowSeparator(.hidden)
                }
                if model.problem == nil, let found = model.found, found.isEmpty {
                    EmptyState(systemImage: "magnifyingglass", text: "pick_none_found").listRowSeparator(.hidden)
                } else if model.loaded && model.found == nil && model.conversations.isEmpty && model.problem == nil {
                    EmptyState(systemImage: "bubble.left.and.bubble.right", text: "pick_empty")
                        .listRowSeparator(.hidden)
                }
                ForEach(model.shown, id: \.id) { conversation in
                    PickRow(conversation: conversation, picked: model.picked.contains(conversation.id)) {
                        model.toggle(conversation.id)
                    }
                }
            }
            .listStyle(.plain)
            // A search's rows come and go in place of the others' (decision 0043).
            .animation(Motion.rows(reduceMotion: reduceMotion), value: model.shown.map(\.id))
            .searchable(
                text: Binding(get: { model.query }, set: { model.query = $0 }),
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text("pick_search")
            )
            .task(id: model.query) {
                guard model.loaded else { return }
                await model.search()
            }
            .navigationTitle(Text(title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("cancel", action: onClose)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    Task { await model.send() }
                } label: {
                    Text("send").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!model.canSend)
                .padding(16)
            }
            .task { await model.load() }
        }
    }
}

/// What is being sent, under a bar as a quote: the message's line, or the post with its author.
private struct OutgoingPreview: View {
    let outgoing: Outgoing

    var body: some View {
        HStack(spacing: 10) {
            Rectangle().fill(BrandTokens.Colors.borderStrong).frame(width: 3).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                switch outgoing {
                case .message(let item):
                    Text(verbatim: lastLine(item)).font(TypeStyle.bubble).lineLimit(3)
                case .post(let post):
                    HStack(spacing: 4) {
                        Text(verbatim: shownName(post.author)).font(.caption.weight(.semibold))
                        if post.author.verified { VerifiedMark(size: 13) }
                    }
                    Text(verbatim: post.body).font(TypeStyle.bubble).lineLimit(3)
                case .postGone:
                    Text("post_gone").font(TypeStyle.bubble).italic()
                }
            }
            .foregroundStyle(BrandTokens.Colors.fg)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }
}

private struct PickRow: View {
    let conversation: Conversation
    let picked: Bool
    let onToggle: () -> Void

    var body: some View {
        let group = conversation.members.count > 1
        // As in the list: a group's circle carries the group's initials, a 1:1's the other person's.
        let initialsOf = group ? title(conversation) : conversation.members.first?.name
        Button(action: onToggle) {
            HStack(spacing: 12) {
                Avatar(name: initialsOf, kind: avatarKind(conversation), photo: photoOf(conversation))
                Text(verbatim: title(conversation)).font(.sans(14.5, black: true)).lineLimit(1)
                if !group, conversation.members.first?.verified == true { VerifiedMark() }
                Spacer()
                Image(systemName: picked ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(picked ? BrandTokens.Colors.primary : BrandTokens.Colors.mutedFg)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(picked ? [.isButton, .isSelected] : .isButton)
    }
}
