import SpjallCore
import SwiftUI

/// The conversation list in pick mode: each row a checkbox, and one send for all the picked ones.
/// A forward (decision 0041) and a shared post (decision 0040) differ only in `title` and what the
/// model does per conversation.
struct PickView: View {
    let model: PickModel
    let title: LocalizedStringKey
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            List {
                if model.sending {
                    ProgressView().progressViewStyle(.linear).listRowSeparator(.hidden)
                }
                if let problem = model.problem {
                    ProblemCard(problem: problem) { Task { await model.retry() } }
                        .listRowSeparator(.hidden)
                }
                if model.loaded && model.conversations.isEmpty && model.problem == nil {
                    Text("pick_empty").listRowSeparator(.hidden)
                }
                ForEach(model.conversations, id: \.id) { conversation in
                    PickRow(conversation: conversation, picked: model.picked.contains(conversation.id)) {
                        model.toggle(conversation.id)
                    }
                }
            }
            .listStyle(.plain)
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
                Avatar(name: initialsOf, kind: avatarKind(conversation))
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
