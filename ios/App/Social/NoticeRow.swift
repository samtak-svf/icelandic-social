import SpjallCore
import SwiftUI

/// One notification (decisions 0103, 0104): the newest actors' pictures with the mark of what happened, the
/// community, the sentence, the snippet it was about and how long ago. A tint and a dot while it is unread, and a
/// menu. A tap opens it; the menu is also on a long press (there is no swipe, decision 0022).
struct NoticeRow: View {
    let notification: SocialNotification
    /// The community it is in, from the hub's cache; nil until that has loaded.
    let community: Community?
    let model: NotificationsModel

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 4) {
                NavigationLink(value: noticeRoute(notification)) {
                    content
                }
                .buttonStyle(.plain)
                .simultaneousGesture(TapGesture().onEnded { Task { await model.open(notification) } })
                menu
            }
            .padding(.leading, 20)
            .padding(.trailing, 4)
            .padding(.vertical, 12)
            .background(notification.read ? Color.clear : BrandTokens.Colors.primarySubtle)
            Hairline().padding(.leading, 76)
        }
        .contextMenu { NoticeMenuItems(notification: notification, model: model) }
    }

    private var content: some View {
        HStack(alignment: .top, spacing: 12) {
            NoticePicture(notification: notification, community: community)
            VStack(alignment: .leading, spacing: 3) {
                if let community {
                    Text(verbatim: community.name)
                        .font(TypeStyle.meta)
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                        .lineLimit(1)
                }
                Text(verbatim: noticeWording(notification).sentence)
                    .font(.sans(14, black: !notification.read))
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .fixedSize(horizontal: false, vertical: true)
                if let snippet = notification.snippet {
                    Text(verbatim: localized("notice_snippet", snippet))
                        .font(.sans(13))
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                        .lineLimit(2)
                }
                Text(verbatim: relativeTime(notification.createdAt))
                    .font(TypeStyle.meta)
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
            }
            Spacer(minLength: 4)
            if !notification.read {
                Circle().fill(BrandTokens.Colors.primary).frame(width: 8, height: 8).padding(.top, 6)
                    .accessibilityHidden(true)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    private var menu: some View {
        Menu {
            NoticeMenuItems(notification: notification, model: model)
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(BrandTokens.Colors.mutedFg)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(Text("notice_menu"))
    }
}

/// What the ⋯ menu and the long press offer.
private struct NoticeMenuItems: View {
    let notification: SocialNotification
    let model: NotificationsModel

    var body: some View {
        Button {
            Task { await model.setRead(notification, !notification.read) }
        } label: {
            Label(
                localized(notification.read ? "notice_menu_unread" : "notice_menu_read"),
                systemImage: notification.read ? "circle.fill" : "checkmark.circle")
        }
        Button(role: .destructive) {
            Task { await model.remove(notification) }
        } label: {
            Label(localized("notice_menu_remove"), systemImage: "trash")
        }
        if model.canQuiet(notification) {
            Button {
                Task { await model.inAppOnly(notification) }
            } label: {
                Label(localized("notice_menu_kind_in_app"), systemImage: "bell.slash")
            }
            Button {
                Task { await model.communityOff(notification) }
            } label: {
                Label(localized("notice_menu_community_off"), systemImage: "speaker.slash")
            }
        }
    }
}

/// The newest actor's picture with the second overlapping it from two on, or the community's picture when there
/// is no one to show, and the mark of what happened on its corner.
private struct NoticePicture: View {
    let notification: SocialNotification
    let community: Community?

    private static let side: CGFloat = 40

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            faces.frame(width: 44, height: 44, alignment: .topLeading)
            badge.offset(x: 4, y: 4)
        }
        .frame(width: 44, height: 44)
        .accessibilityHidden(true)
    }

    @ViewBuilder private var faces: some View {
        let actors = Array(notification.actors.prefix(notification.actorCount >= 2 ? 2 : 1))
        if actors.isEmpty {
            if let community {
                CommunityBadge(community: community, size: Self.side)
            } else {
                Circle().fill(BrandTokens.Colors.secondarySubtle).frame(width: Self.side, height: Self.side)
            }
        } else if actors.count == 1 {
            face(actors[0], size: Self.side)
        } else {
            ZStack(alignment: .topLeading) {
                face(actors[1], size: 28).offset(x: 14, y: 14)
                face(actors[0], size: 28)
                    .overlay { Circle().strokeBorder(BrandTokens.Colors.bg, lineWidth: 2) }
            }
        }
    }

    private func face(_ author: Author, size: CGFloat) -> some View {
        Avatar(
            name: author.name, kind: author.verified == true ? .verified : .unverified, size: size,
            photo: author.photoOf)
    }

    private var badge: some View {
        Group {
            switch noticeWording(notification).badge {
            case .emoji:
                Text(verbatim: notification.emoji ?? "♥").font(.system(size: 12))
            case .comment: symbol("text.bubble.fill")
            case .approved: symbol("checkmark")
            case .moderator: symbol("shield.fill")
            }
        }
        .frame(width: 20, height: 20)
        .background(BrandTokens.Colors.bg, in: Circle())
        .overlay { Circle().strokeBorder(BrandTokens.Colors.border, lineWidth: 1) }
    }

    private func symbol(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(BrandTokens.Colors.fg)
    }
}
