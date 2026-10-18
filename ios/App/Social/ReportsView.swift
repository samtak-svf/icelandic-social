import SpjallCore
import SwiftUI

/// A community's open reports, for its moderators (decision 0063): why each was made and what it reported,
/// then a reason, which goes in the log, and hide, remove or close.
struct ReportsView: View {
    let model: ReportsModel

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if model.done {
                    SocialNote(text: "moderation_done")
                }
                if model.loaded && model.reports.isEmpty && model.problem == nil {
                    EmptyState(systemImage: "tray", text: "moderation_queue_empty")
                }
                ForEach(model.reports, id: \.reportId) { report in
                    ReportCard(report: report, card: model.cards[report.target.id], model: model)
                }
                if model.next != nil {
                    Color.clear.frame(height: 1).task(id: model.next) { await model.more() }
                }
            }
            .padding(16)
        }
        .background(BrandTokens.Colors.bg)
        .navigationTitle(Text("moderation_queue"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .safeAreaInset(edge: .top) {
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.retry() } }.padding(16)
            }
        }
        .task { await model.load() }
    }
}

/// One report: its reason, when, the reporter's note, an excerpt of what it reported, and the moderator's
/// reason with the actions it allows.
private struct ReportCard: View {
    let report: Report
    let card: Card?
    let model: ReportsModel

    @State private var reason = ""

    private var ready: Bool { ReportsModel.valid(reason) && !model.busy }
    /// A post or a comment, which a moderator may hide or remove; anything else is only closed.
    private var content: Bool { moderation(report.target.kind, remove: false) != nil }

    var body: some View {
        Panel {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text(verbatim: reasonLabel(report.reason))
                        .font(.sans(14.5, black: true))
                        .foregroundStyle(BrandTokens.Colors.fg)
                    Spacer(minLength: 8)
                    Text(verbatim: listStamp(report.createdAt))
                        .font(TypeStyle.meta)
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                }
                if !report.note.isEmpty {
                    Text(verbatim: report.note)
                        .font(.sans(14))
                        .foregroundStyle(BrandTokens.Colors.proseBody)
                        .fixedSize(horizontal: false, vertical: true)
                }
                excerpt
                TextField("report_reason", text: $reason, axis: .vertical)
                    .font(.sans(14))
                    .lineLimit(1...4)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: 10))
                    .onChange(of: reason) { _, text in
                        if text.count > ReportsModel.reasonLimit {
                            reason = String(text.prefix(ReportsModel.reasonLimit))
                        }
                    }
                ViewThatFits {
                    HStack(spacing: 8) { actions }
                    VStack(spacing: 8) { actions }
                }
            }
            .padding(14)
        }
    }

    /// What was reported, as its card shows it, when it is a post or a comment that can still be had.
    @ViewBuilder private var excerpt: some View {
        switch card {
        case .post(_, _, let author, let excerpt, _, _), .comment(_, _, _, let author, let excerpt, _):
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: authorName(author)).font(.sans(13, black: true))
                Text(verbatim: excerpt).font(.sans(13.5)).fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(BrandTokens.Colors.fg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: 10))
        default:
            EmptyView()
        }
    }

    @ViewBuilder private var actions: some View {
        if content {
            Button {
                Task { await model.act(report, remove: false, reason: reason) }
            } label: {
                PillLabel(text: "moderation_hide", filled: true, wide: false)
            }
            .buttonStyle(.plain)
            .disabled(!ready)
            Button {
                Task { await model.act(report, remove: true, reason: reason) }
            } label: {
                Text("moderation_remove")
                    .font(.sans(12.5, black: true))
                    .foregroundStyle(BrandTokens.Colors.danger)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 40)
                    .overlay { Capsule().strokeBorder(BrandTokens.Colors.danger, lineWidth: 1) }
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(!ready)
        }
        Button {
            Task { await model.dismiss(report, reason: reason) }
        } label: {
            PillLabel(text: "moderation_dismiss", filled: false, wide: false)
        }
        .buttonStyle(.plain)
        .disabled(!ready)
    }
}
