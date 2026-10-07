import SpjallCore
import SwiftUI

/// What a long press offers on an item.
struct Offer {
    let reply: Bool
    let react: Bool
    let edit: Bool
    let delete: Bool

    init(_ item: Item) {
        let live = item.seq != nil && item.envelopeId != nil && item.content != .deleted
        var text = false
        if case .text = item.content { text = true }
        reply = live
        react = live
        edit = live && item.own && text
        delete = live && item.own
    }

    var any: Bool { reply || react || edit || delete }
}

/// One message: own on the right, its reactions, and a read line under the newest read.
struct Bubble: View {
    let item: Item
    let first: Bool
    let readBy: UInt32?
    let group: Bool
    let model: ConversationModel
    let onDelete: () -> Void
    let onReact: () -> Void

    private var offer: Offer { Offer(item) }
    private var background: Color { item.own ? BrandTokens.Colors.bubbleOwnBg : BrandTokens.Colors.bubbleOtherBg }
    private var foreground: Color { item.own ? BrandTokens.Colors.bubbleOwnFg : BrandTokens.Colors.bubbleOtherFg }

    var body: some View {
        VStack(alignment: item.own ? .trailing : .leading, spacing: 2) {
            if group && first && !item.own {
                Text(verbatim: shownName(item.sender))
                    .font(.caption)
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                    .padding(.horizontal, 12)
            }
            bubble
            if !item.reactions.isEmpty { Reactions(item: item, enabled: offer.react, model: model) }
            if item.status == .failed { Failed(onResend: model.resend) }
            if let readBy { ReadLine(count: readBy, group: group) }
        }
        .frame(maxWidth: .infinity, alignment: item.own ? .trailing : .leading)
        .padding(.horizontal, 12)
        .padding(.top, first ? 8 : 0)
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 4) {
            BodyText(item: item, foreground: foreground, model: model)
            Text(verbatim: meta)
                .font(.caption2)
                .foregroundStyle(foreground)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(background, in: RoundedRectangle(cornerRadius: 18))
        .frame(maxWidth: 320, alignment: item.own ? .trailing : .leading)
        .contextMenu {
            if offer.any { menu }
        }
        .accessibilityElement(children: .combine)
        .accessibilityActions {
            if offer.reply { Button("reply") { model.reply(item) } }
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
        if offer.edit { Button("edit", systemImage: "pencil") { model.edit(item) } }
        if offer.delete { Button("delete_for_everyone", systemImage: "trash", role: .destructive, action: onDelete) }
    }

    private var meta: String {
        var parts: [String] = []
        if item.edited { parts.append(localized("edited_marker")) }
        switch item.status {
        case .pending: parts.append(localized("message_sending"))
        case .sent, .failed:
            parts.append(
                Date(timeIntervalSince1970: TimeInterval(item.ts) / 1_000).formatted(date: .omitted, time: .shortened))
        }
        return parts.joined(separator: " · ")
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
                    Text(verbatim: quote.text ?? localized("message_deleted")).font(.caption).italic().lineLimit(2)
                    Divider().overlay(foreground)
                }
                .foregroundStyle(foreground)
            }
            Text(verbatim: text).foregroundStyle(foreground)
        case .deleted:
            Text("message_deleted").italic().foregroundStyle(foreground)
        case .media(let mime, let size, let caption, let name):
            Attachment(
                item: item, mime: mime, size: size, caption: caption, name: name, foreground: foreground,
                model: model)
        case .members, .timer:
            Text(verbatim: lastLine(item)).foregroundStyle(foreground)
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
            Text("message_failed").font(.caption).foregroundStyle(BrandTokens.Colors.danger)
            Button("try_again", action: onResend).font(.caption)
        }
    }
}

private struct ReadLine: View {
    let count: UInt32
    let group: Bool

    var body: some View {
        Group {
            if group {
                Text(verbatim: plural("read_by_count", Int(count)))
            } else {
                Text("read_marker")
            }
        }
        .font(.caption2)
        .foregroundStyle(BrandTokens.Colors.mutedFg)
        .padding(.horizontal, 4)
    }
}
