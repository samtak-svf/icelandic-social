import SpjallCore
import SwiftUI

/// What a long press offers on an item.
struct Offer {
    let reply: Bool
    /// Text or a file, not under a timer, where a copy would outlive the original (decision 0041);
    /// never a shared post (decision 0044).
    let forward: Bool
    let react: Bool
    let edit: Bool
    let delete: Bool

    init(_ item: Item) {
        let live = item.seq != nil && item.envelopeId != nil && item.content != .deleted
        var text = false
        var copyable = false
        switch item.content {
        case .text:
            text = true
            copyable = true
        case .media:
            copyable = true
        case .post, .deleted, .members, .timer:
            break
        }
        reply = live
        forward = live && item.expiresAt == nil && copyable
        react = live
        edit = live && item.own && text
        delete = live && item.own
    }

    var any: Bool { reply || react || edit || delete }
}

/// One message (1c): own on the right in red, the other party's on the left
/// in muted, the corner nearest the sender squared off. Under the end of a
/// run, its time, and on the newest own message someone read, the read marker.
struct Bubble: View {
    let item: Item
    let first: Bool
    let last: Bool
    let readBy: UInt32?
    let group: Bool
    let model: ConversationModel
    let onDelete: () -> Void
    let onReact: () -> Void
    /// Opens the picker that copies this message into other conversations.
    var onForward: () -> Void = {}

    private var offer: Offer { Offer(item) }
    private var background: Color { item.own ? BrandTokens.Colors.bubbleOwnBg : BrandTokens.Colors.bubbleOtherBg }
    private var foreground: Color { item.own ? BrandTokens.Colors.bubbleOwnFg : BrandTokens.Colors.bubbleOtherFg }

    /// Rounded all round but at the bottom corner on the sender's side.
    private var shape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: Self.radius,
            bottomLeadingRadius: item.own ? Self.radius : Self.tail,
            bottomTrailingRadius: item.own ? Self.tail : Self.radius,
            topTrailingRadius: Self.radius
        )
    }

    var body: some View {
        VStack(alignment: item.own ? .trailing : .leading, spacing: 0) {
            if group && first && !item.own {
                Text(verbatim: shownName(item.sender))
                    .font(TypeStyle.meta)
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 2)
            }
            if item.content == .deleted {
                // A tombstone is a quiet line, not a bubble: there is nothing left to press.
                Text("message_deleted")
                    .font(TypeStyle.bubble)
                    .italic()
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                    .padding(4)
            } else {
                AtMost(fraction: Self.share) { bubble }
            }
            if !item.reactions.isEmpty {
                Reactions(item: item, enabled: offer.react, model: model).padding(.top, 2)
            }
            if item.status == .failed {
                Failed(onResend: model.resend)
            } else if !parts.isEmpty {
                HStack(spacing: 4) {
                    if let words { Text(verbatim: words) }
                    if parts.contains(.sending) {
                        Image(systemName: "clock")
                            .accessibilityLabel(Text("message_sending"))
                    }
                }
                .font(TypeStyle.meta)
                .foregroundStyle(BrandTokens.Colors.mutedFg)
                .padding(.horizontal, 4)
                .padding(.vertical, 3)
            }
        }
        .frame(maxWidth: .infinity, alignment: item.own ? .trailing : .leading)
        .padding(.horizontal, 16)
        .padding(.top, first ? 8 : 0)
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 4) {
            if item.forwarded { ForwardedMark(foreground: foreground) }
            BodyText(item: item, foreground: foreground, model: model)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(background, in: shape)
        .contentShape(.contextMenuPreview, shape)
        .contextMenu {
            if offer.any { menu }
        }
        .accessibilityElement(children: .combine)
        .accessibilityActions {
            if offer.reply { Button("reply") { model.reply(item) } }
            if offer.forward { Button("forward") { onForward() } }
            if offer.edit { Button("edit") { model.edit(item) } }
            if offer.delete { Button("delete_for_everyone", action: onDelete) }
            if offer.react { Button("react", action: onReact) }
        }
    }

    @ViewBuilder private var menu: some View {
        if offer.react {
            ControlGroup {
                ForEach(emoji, id: \.self) { emoji in
                    Button(emoji) { Task { await model.react(item, emoji) } }
                }
            }
        }
        if offer.reply { Button("reply", systemImage: "arrowshape.turn.up.left") { model.reply(item) } }
        if offer.forward { Button("forward", systemImage: "arrowshape.turn.up.right") { onForward() } }
        if offer.edit { Button("edit", systemImage: "pencil") { model.edit(item) } }
        if offer.delete { Button("delete_for_everyone", systemImage: "trash", role: .destructive, action: onDelete) }
    }

    /// The small line under a message (`meta`): the edited marker, then a
    /// clock while sending (decision 0043) or the time, then who read it.
    private var parts: [MetaPart] { meta(item, last: last, readBy: readBy) }

    /// The line's words; the clock is drawn beside them.
    private var words: String? {
        let words = parts.compactMap { part -> String? in
            switch part {
            case .edited: localized("edited_marker")
            case .sending: nil
            case .time: clockTime(item.ts)
            case .read: readBy.map { readMarker($0, group: group) }
            }
        }
        return words.isEmpty ? nil : words.joined(separator: " · ")
    }

    private static let radius: CGFloat = 18
    private static let tail: CGFloat = 5
    private static let share: CGFloat = 0.76
}

private struct BodyText: View {
    let item: Item
    let foreground: Color
    let model: ConversationModel

    var body: some View {
        switch item.content {
        case .text(let text, let quote):
            if let quote {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: quote.sender.map(shownName) ?? "").font(.caption.weight(.semibold))
                    if quote.postId != nil {
                        // A reply to a share quotes the post as its card: the store holds no text of it.
                        SharedCard(foreground: foreground)
                    } else {
                        Text(verbatim: quote.text ?? localized("message_deleted")).font(.caption).italic().lineLimit(2)
                    }
                    Divider().overlay(foreground)
                }
                .foregroundStyle(foreground)
            }
            Text(verbatim: text).font(TypeStyle.bubble).lineSpacing(3).foregroundStyle(foreground)
        case .deleted:
            // Drawn by Bubble as a line of its own.
            EmptyView()
        case .media(let mime, let size, let caption, let name):
            Attachment(
                item: item, mime: mime, size: size, caption: caption, name: name, foreground: foreground,
                model: model)
        case .post:
            SharedCard(foreground: foreground)
        case .members, .timer:
            Text(verbatim: lastLine(item)).font(TypeStyle.bubble).foregroundStyle(foreground)
        }
    }
}

private struct Reactions: View {
    let item: Item
    let enabled: Bool
    let model: ConversationModel

    var body: some View {
        HStack(spacing: 4) {
            ForEach(item.reactions, id: \.emoji) { reaction in
                Button {
                    Task { await model.react(item, reaction.emoji) }
                } label: {
                    Text(verbatim: "\(reaction.emoji) \(reaction.people.count)")
                        .font(.subheadline)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .frame(minHeight: 44)
                }
                // Own reactions take the gold chip pair, the others fg on muted.
                .foregroundStyle(reaction.own ? BrandTokens.Colors.secondaryFg : BrandTokens.Colors.fg)
                .background(
                    reaction.own ? BrandTokens.Colors.secondary : BrandTokens.Colors.muted,
                    in: RoundedRectangle(cornerRadius: 12)
                )
                .disabled(!enabled)
            }
        }
    }
}

private struct Failed: View {
    let onResend: () -> Void

    var body: some View {
        HStack {
            Text("message_failed").font(TypeStyle.meta).foregroundStyle(BrandTokens.Colors.danger)
            Button("try_again", action: onResend).font(.sans(12, black: true, relativeTo: .caption))
        }
    }
}

/// Who read the reader's message (decision 0022): "Lesin" in a 1:1, the count in a group; the list's row
/// says the same.
func readMarker(_ count: UInt32, group: Bool) -> String {
    group ? plural("read_by_count", Int(count)) : localized("read_marker")
}

/// The read marker for the reader's own sent `item` that someone read, or nil (decision 0043).
func readLine(_ item: Item, group: Bool) -> String? {
    guard item.own, item.status == .sent, item.readBy > 0 else { return nil }
    return readMarker(item.readBy, group: group)
}
