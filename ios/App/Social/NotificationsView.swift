import SpjallCore
import SwiftUI

/// The notifications tab (decision 0063), newest first; an unread one is marked. A tap opens its post, or its
/// community when there is no post to open. Opening the tab marks read every one up to the newest.
struct NotificationsView: View {
    let model: NotificationsModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(title: localized("tab_notifications"))
            if model.busy {
                ProgressView().progressViewStyle(.linear)
            }
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
            }
            ScrollView {
                LazyVStack(spacing: 0) {
                    if model.loaded && model.notifications.isEmpty && model.problem == nil {
                        EmptyState(systemImage: "bell", text: "notifications_empty")
                    }
                    ForEach(model.notifications, id: \.notificationId) { notification in
                        NavigationLink(value: noticeRoute(notification)) {
                            NoticeRow(notification: notification)
                        }
                        .buttonStyle(.plain)
                    }
                    if model.next != nil {
                        Color.clear.frame(height: 1).task(id: model.next) { await model.more() }
                    }
                }
                .animation(Motion.rows(reduceMotion: reduceMotion), value: model.notifications.map(\.notificationId))
            }
            .refreshable { await model.load() }
        }
        .background(BrandTokens.Colors.bg)
        .navigationTitle(Text("tab_notifications"))
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await model.load()
            await model.markRead()
        }
    }
}

/// One notification: who, what, when, and a dot while it is unread.
private struct NoticeRow: View {
    let notification: SocialNotification

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .frame(width: 40, height: 40)
                    .background(BrandTokens.Colors.secondarySubtle, in: Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(verbatim: noticeLine(notification))
                        .font(.sans(14, black: !notification.read))
                        .foregroundStyle(BrandTokens.Colors.fg)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(verbatim: listStamp(notification.createdAt))
                        .font(TypeStyle.meta)
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                }
                Spacer(minLength: 8)
                if !notification.read {
                    Circle().fill(BrandTokens.Colors.primary).frame(width: 8, height: 8).padding(.top, 6)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            Hairline().padding(.leading, 72)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    private var icon: String {
        switch notification.kind {
        case .comment: "text.bubble"
        case .reply: "text.bubble"
        case .reaction: "heart"
        case .joinApproved: "person.badge.plus"
        case .moderated: "shield"
        }
    }
}
