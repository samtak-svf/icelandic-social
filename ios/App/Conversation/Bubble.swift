import SpjallCore
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// What a long press offers on an item.
struct Offer {
    let reply: Bool
    /// A text's words, under a timer too: the reader can already read them (decision 0046).
    let copy: Bool
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
        copy = text
        forward = live && item.expiresAt == nil && copyable
        react = live
        edit = live && item.own && text
        delete = live && item.own
    }

    var any: Bool { reply || copy || react || edit || delete }
}

/// One message (1c): own on the right in red, the other party's on the left
/// in muted, the corner nearest the sender squared off. Its reactions are one
/// pill on its bottom edge (decision 0045). Under it, the edited marker, the
/// sending clock and, on the newest own message someone read, the read marker;
/// a tap on a text shows its time there too.
struct Bubble: View {
    let item: Item
    let first: Bool
    let last: Bool
    let readBy: UInt32?
    let group: Bool
    let model: ConversationModel
    let onDelete: () -> Void
    let onReact: () -> Void
    /// Opens the sheet of who reacted (decision 0045).
    var onReactions: () -> Void = {}
    /// Opens the picker that copies this message into other conversations.
    var onForward: () -> Void = {}
    /// Says the text was copied (decision 0046).
    var onCopy: () -> Void = {}

    /// A tap on a text shows its time under it, until the next tap.
    @State private var showsTime = false
    @Environment(\.openURL) private var openURL

    private var offer: Offer { Offer(item) }
    private var background: Color { item.own ? BrandTokens.Colors.bubbleOwnBg : BrandTokens.Colors.bubbleOtherBg }
    private var foreground: Color { item.own ? BrandTokens.Colors.bubbleOwnFg : BrandTokens.Colors.bubbleOtherFg }

    private var isText: Bool {
        if case .text = item.content { return true }
        return false
    }

    /// The text's words without the quote, which a copy takes and its links are found in.
    private var plainText: String? {
        if case .text(let text, _) = item.content { return text }
        return nil
    }

    private var links: [WebLink] { plainText.map(webLinks) ?? [] }

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
                // The pill hangs this far below the bubble, so what follows moves down by it.
                Color.clear.frame(height: ReactionPill.overlap)
            }
            if item.status == .failed {
                Failed(onResend: model.resend)
            } else if !words.isEmpty || parts.contains(.sending) {
                HStack(spacing: 4) {
                    if !words.isEmpty { Text(verbatim: words) }
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
        // A photo and a file keep their own tap, which opens them.
        .onTap(if: isText) { showsTime.toggle() }
        .contextMenu {
            if offer.any { menu }
        }
        // At the end facing the middle of the screen, half over the bubble's bottom edge.
        .overlay(alignment: item.own ? .bottomLeading : .bottomTrailing) {
            if !item.reactions.isEmpty {
                ReactionPill(reactions: item.reactions, action: onReactions)
                    .alignmentGuide(.bottom) { $0.height / 2 }
                    // The bubble says it, and its action opens the sheet.
                    .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(Text(verbatim: spoken))
        .accessibilityActions {
            if !item.reactions.isEmpty { Button("reactions_show", action: onReactions) }
            if offer.reply { Button("reply") { model.reply(item) } }
            if offer.copy { Button("copy", action: copy) }
            if offer.forward { Button("forward") { onForward() } }
            if offer.edit { Button("edit") { model.edit(item) } }
            if offer.delete { Button("delete_for_everyone", action: onDelete) }
            if offer.react { Button("react", action: onReact) }
            // Each web link opens in the browser, named as written (decision 0046).
            ForEach(links, id: \.range.lowerBound) { link in
                Button(localized("link_open", link.written)) { openURL(link.url) }
            }
        }
    }

    /// The whole text, without its quote, on this device only (decision 0046).
    private func copy() {
        guard let plainText else { return }
        UIPasteboard.general.setItems([[UTType.plainText.identifier: plainText]], options: [.localOnly: true])
        onCopy()
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
        if offer.copy { Button("copy", systemImage: "doc.on.doc", action: copy) }
        if offer.forward { Button("forward", systemImage: "arrowshape.turn.up.right") { onForward() } }
        if offer.edit { Button("edit", systemImage: "pencil") { model.edit(item) } }
        if offer.delete { Button("delete_for_everyone", systemImage: "trash", role: .destructive, action: onDelete) }
    }

    /// What VoiceOver says after the message: its time (decision 0022), then
    /// how many reactions it holds (decision 0045).
    private var spoken: String {
        var said = [clockTime(item.ts)]
        let count = reactionCount(item.reactions)
        if count > 0 { said.append(plural("reaction_count", count)) }
        return said.joined(separator: ", ")
    }

    /// The small line under a message (`meta`): the edited marker, then a
    /// clock while sending (decision 0043), then who read it.
    private var parts: [MetaPart] { meta(item, readBy: readBy) }

    /// The line's words, led by the time when a tap showed it; the clock is drawn beside them.
    private var words: String {
        var words: [String] = showsTime ? [clockTime(item.ts)] : []
        words += parts.compactMap { part -> String? in
            switch part {
            case .edited: localized("edited_marker")
            case .sending: nil
            case .read: readBy.map { readMarker($0, group: group) }
            }
        }
        return words.joined(separator: " · ")
    }

    private static let radius: CGFloat = 18
    private static let tail: CGFloat = 5
    private static let share: CGFloat = 0.76
}

extension View {
    /// `action` on a tap, or no tap gesture at all, so a child's own tap is left alone.
    @ViewBuilder fileprivate func onTap(if enabled: Bool, _ action: @escaping () -> Void) -> some View {
        if enabled {
            onTapGesture(perform: action)
        } else {
            self
        }
    }
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
            // A tap on a link opens it in the browser (decision 0046); elsewhere it shows the time.
            Text(linked(text, webLinks(text), foreground: foreground))
                .font(TypeStyle.bubble)
                .lineSpacing(3)
                .foregroundStyle(foreground)
                .tint(foreground)
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

/// A bubble's reactions as one pill (decision 0045): up to three emoji, the
/// most used first, then how many there are when more than one. The gold chip
/// pair when one of them is the reader's, else fg on muted.
private struct ReactionPill: View {
    let reactions: [Reaction]
    let action: () -> Void

    /// Half the drawn pill's height: how far it hangs below the bubble.
    static let overlap: CGFloat = 13
    /// Around the drawn pill, so a finger finds it: 44 points high.
    private static let reach: CGFloat = 9

    private var own: Bool { reactions.contains { $0.own } }

    var body: some View {
        let count = reactionCount(reactions)
        Button(action: action) {
            HStack(spacing: 3) {
                Text(verbatim: pillEmoji(reactions).joined()).font(.footnote)
                if count > 1 { Text(verbatim: "\(count)").font(TypeStyle.meta) }
            }
            .padding(.horizontal, 7)
            .frame(minHeight: 2 * Self.overlap)
            .foregroundStyle(own ? BrandTokens.Colors.secondaryFg : BrandTokens.Colors.fg)
            .background(own ? BrandTokens.Colors.secondary : BrandTokens.Colors.muted, in: Capsule())
            .overlay { Capsule().strokeBorder(BrandTokens.Colors.surface, lineWidth: 1.5) }
            .padding(Self.reach)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// The emoji a reaction pill shows (decision 0045): up to three, the one most
/// people used first; a tie keeps the core's order.
func pillEmoji(_ reactions: [Reaction]) -> [String] {
    let ranked = reactions.enumerated().sorted { one, other in
        let (left, right) = (one.element.people.count, other.element.people.count)
        return left == right ? one.offset < other.offset : left > right
    }
    return ranked.prefix(3).map { $0.element.emoji }
}

/// How many reactions an item holds: one per person per emoji.
func reactionCount(_ reactions: [Reaction]) -> Int {
    reactions.reduce(0) { $0 + $1.people.count }
}

/// One line of the reactions sheet: who, with which emoji, and whether it is the reader's own.
struct Reacted: Equatable, Identifiable {
    let person: Person
    let emoji: String
    let own: Bool

    var id: String { "\(person.account) \(emoji)" }
}

/// Who reacted with what (decision 0045), the reader's own first. The reader is
/// the one in every own reaction who is not among `others`, the conversation's
/// other members.
func reacted(_ reactions: [Reaction], others: [Person]) -> [Reacted] {
    let owned = reactions.filter { $0.own }
    var candidates = owned.first?.people.map { $0.account } ?? []
    for reaction in owned.dropFirst() {
        let there = Set(reaction.people.map { $0.account })
        candidates = candidates.filter { there.contains($0) }
    }
    let elsewhere = Set(others.map { $0.account })
    let reader = candidates.first { !elsewhere.contains($0) } ?? candidates.first
    var mine: [Reacted] = []
    var theirs: [Reacted] = []
    for reaction in reactions {
        for person in reaction.people {
            let own = reaction.own && person.account == reader
            let row = Reacted(person: person, emoji: reaction.emoji, own: own)
            if own { mine.append(row) } else { theirs.append(row) }
        }
    }
    return mine + theirs
}

/// The sheet a reaction pill opens (decision 0045): each person with their
/// emoji, the reader first. Tapping one of the reader's own rows takes that
/// reaction away and closes the sheet.
struct ReactionsSheet: View {
    let item: Item
    let others: [Person]
    let model: ConversationModel

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let removable = Offer(item).react
        NavigationStack {
            List {
                ForEach(reacted(item.reactions, others: others)) { row in
                    if row.own && removable {
                        Button {
                            dismiss()
                            Task { await model.react(item, row.emoji) }
                        } label: {
                            line(row, hint: true)
                        }
                    } else {
                        line(row, hint: false)
                    }
                }
                .foregroundStyle(BrandTokens.Colors.fg)
            }
            .scrollContentBackground(.hidden)
            .background(BrandTokens.Colors.surface)
            .navigationTitle(Text("reactions_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("cancel") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func line(_ row: Reacted, hint: Bool) -> some View {
        HStack(spacing: 12) {
            Avatar(person: row.person, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: shownName(row.person)).foregroundStyle(BrandTokens.Colors.fg)
                if hint {
                    Text("reaction_remove_hint").font(.footnote).foregroundStyle(BrandTokens.Colors.mutedFg)
                }
            }
            Spacer(minLength: 0)
            Text(verbatim: row.emoji).font(.title3)
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
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
