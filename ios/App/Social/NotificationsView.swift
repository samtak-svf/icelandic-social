import SpjallCore
import SwiftUI

/// The notifications the bell opens (decisions 0063, 0103, 0104, 0109): the rows made since the last look under
/// "new", the rest under "earlier", newest first. A tap reads a row and opens its post, or its community when there
/// is no post to open. Opening the list marks it seen; "mark all read" reads it.
struct NotificationsView: View {
    let model: NotificationsModel
    let communities: CommunitiesModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(title: localized("notifications_title")) {
                if model.unread > 0 {
                    Button(localized("notifications_mark_all_read")) { Task { await model.markAllRead() } }
                        .font(.sans(13, black: true, relativeTo: .subheadline))
                        .foregroundStyle(BrandTokens.Colors.primary)
                        .frame(minHeight: 44)
                        .padding(.horizontal, 12)
                }
            }
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
                    section("notice_section_new", model.fresh)
                    section("notice_section_earlier", model.earlier)
                    if model.next != nil {
                        Color.clear.frame(height: 1).task(id: model.next) { await model.more() }
                    }
                }
                .animation(Motion.rows(reduceMotion: reduceMotion), value: model.notifications.map(\.notificationId))
            }
            .refreshable { await model.load() }
        }
        .background(BrandTokens.Colors.bg)
        .navigationTitle(Text("notifications_title"))
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await model.appear()
            if !communities.loaded { await communities.load() }
        }
    }

    /// A header and its rows; a section with none is left out.
    @ViewBuilder private func section(_ title: String, _ rows: [SocialNotification]) -> some View {
        if !rows.isEmpty {
            Text(verbatim: localized(title))
                .font(.sans(13, black: true, relativeTo: .subheadline))
                .foregroundStyle(BrandTokens.Colors.fg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 14)
                .padding(.bottom, 6)
                .accessibilityAddTraits(.isHeader)
            ForEach(rows, id: \.notificationId) { notification in
                NoticeRow(
                    notification: notification,
                    community: communities.mine.first { $0.communityId == notification.communityId },
                    model: model)
            }
        }
    }
}
