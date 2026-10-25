import SpjallCore
import SwiftUI

/// A community's open or closed reports, for its moderators (decision 0063): why each was made and what it
/// reported, then a reason, which goes in the log, and the moderator's answers to it and to its author. A ban
/// asks first.
struct ReportsView: View {
    let model: ReportsModel

    /// The report whose author a ban is asked for, with the reason, until it is confirmed or cancelled.
    @State private var banning: Banning?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                Picker(
                    "moderation_queue",
                    selection: Binding(
                        get: { model.showing },
                        set: { state in Task { await model.show(state) } })
                ) {
                    Text("moderation_open").tag(ReportState.open)
                    Text("moderation_closed").tag(ReportState.closed)
                }
                .pickerStyle(.segmented)
                .disabled(model.busy)
                if model.done {
                    SocialNote(text: "moderation_done")
                }
                if model.loaded && model.reports.isEmpty && model.problem == nil {
                    EmptyState(
                        systemImage: "tray",
                        text: model.showing == .open ? "moderation_queue_empty" : "moderation_closed_empty")
                }
                ForEach(model.reports, id: \.reportId) { report in
                    ReportCard(
                        report: report, card: model.cards[report.target.id], model: model,
                        onBan: { reason in banning = Banning(report: report, reason: reason) })
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
        .confirmationDialog(
            "moderation_ban_confirm",
            isPresented: Binding(get: { banning != nil }, set: { if !$0 { banning = nil } }),
            titleVisibility: .visible,
            presenting: banning
        ) { banning in
            Button("moderation_ban", role: .destructive) {
                Task { await model.act(banning.report, .ban, reason: banning.reason) }
            }
            Button("cancel", role: .cancel) {}
        }
    }
}

/// A ban waiting for the moderator to confirm it.
private struct Banning {
    let report: Report
    let reason: String
}

/// One report: its reason, when, the reporter's note, an excerpt of what it reported, and the moderator's
/// reason with the actions it allows.
private struct ReportCard: View {
    let report: Report
    let card: Card?
    let model: ReportsModel
    /// A ban asks first, with the reason written.
    let onBan: (String) -> Void

    @State private var reason = ""

    private var ready: Bool { ReportsModel.valid(reason) && !model.busy }
    /// A post or a comment, which a moderator may hide, remove or restore.
    private var content: Bool { moderation(report, .hide) != nil }
    private var open: Bool { report.state == .open }
    /// What may be done about the target as it stands now (#361).
    private var offered: Set<ModerationVerb> { offeredVerbs(report) }
    private var memberVerbs: Bool { member(report) != nil && offered.contains { $0.onMember } }
    private var contentVerbs: Bool { content && offered.contains { !$0.onMember && $0 != .dismiss } }

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
                if let author = model.revealed[report.reportId] {
                    RevealedAuthorLine(author: author)
                } else if model.canReveal(report) {
                    RevealAuthorButton { Task { await model.reveal(report) } }.disabled(model.busy)
                }
                decision
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
                if !ReportsModel.valid(reason) {
                    Text("moderation_reason_required")
                        .font(TypeStyle.meta)
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if contentVerbs || open {
                    ViewThatFits {
                        HStack(spacing: 8) { actions }
                        VStack(spacing: 8) { actions }
                    }
                }
                if memberVerbs {
                    Text("moderation_member")
                        .font(.sans(13.5, black: true))
                        .foregroundStyle(BrandTokens.Colors.fg)
                        .accessibilityAddTraits(.isHeader)
                    ViewThatFits {
                        HStack(spacing: 8) { memberActions }
                        VStack(spacing: 8) { memberActions }
                    }
                }
            }
            .padding(14)
        }
    }

    /// What was reported, as its card shows it, when it is a post or a comment that can still be had.
    @ViewBuilder private var excerpt: some View {
        switch card {
        case .post(_, _, let author, let excerpt, _, _):
            excerptCard(byline: cardByline(author), excerpt: excerpt)
        case .comment(_, _, _, let author, let excerpt, _):
            excerptCard(byline: authorName(author), excerpt: excerpt)
        default:
            EmptyView()
        }
    }

    private func excerptCard(byline: String, excerpt: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: byline).font(.sans(13, black: true))
            Text(verbatim: excerpt).font(.sans(13.5)).fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(BrandTokens.Colors.fg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: 10))
    }

    /// What a closed report came to: the decision, its reason, and who closed it and when (#360).
    @ViewBuilder private var decision: some View {
        if !open {
            VStack(alignment: .leading, spacing: 4) {
                if let chosen = report.decision, let words = decisionLabel(chosen) {
                    Text(verbatim: words).font(.sans(13.5, black: true))
                }
                if let resolution = report.resolution, !resolution.isEmpty {
                    Text(verbatim: resolution).font(.sans(13.5)).fixedSize(horizontal: false, vertical: true)
                }
                if let closedAt = report.closedAt {
                    Text(verbatim: closedLine(closedAt))
                        .font(TypeStyle.meta)
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                }
            }
            .foregroundStyle(BrandTokens.Colors.fg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }

    /// Who closed the report and when, or only when no account is named.
    private func closedLine(_ closedAt: UInt64) -> String {
        guard let by = report.closedBy else { return localized("moderation_closed_at", calendarDate(closedAt)) }
        return localized("moderation_closed_by", authorName(by), calendarDate(closedAt))
    }

    @ViewBuilder private var actions: some View {
        if content && offered.contains(.hide) {
            Button {
                Task { await model.act(report, .hide, reason: reason) }
            } label: {
                PillLabel(text: "moderation_hide", filled: true, wide: false)
            }
            .buttonStyle(.plain)
            .disabled(!ready)
        }
        if content && offered.contains(.remove) {
            Button {
                Task { await model.act(report, .remove, reason: reason) }
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
        if content && offered.contains(.restore) {
            verb("moderation_restore", .restore)
        }
        if offered.contains(.dismiss) {
            verb("moderation_dismiss", .dismiss)
        }
    }

    /// What may be done to the author of what the report names: mute for a time, unmute, ban (asked first) or
    /// unban.
    @ViewBuilder private var memberActions: some View {
        if offered.contains(.mute) {
            muteMenu
        }
        if offered.contains(.unmute) {
            verb("moderation_unmute", .unmute)
        }
        if offered.contains(.ban) {
            banButton
        }
        if offered.contains(.unban) {
            verb("moderation_unban", .unban)
        }
    }

    private var muteMenu: some View {
        Menu {
            Section {
                ForEach(MutePeriod.allCases, id: \.self) { period in
                    Button(periodLabel(period)) {
                        Task { await model.act(report, .mute, reason: reason, period: period) }
                    }
                }
            } header: {
                Text("moderation_mute_for")
            }
        } label: {
            PillLabel(text: "moderation_mute", filled: false, wide: false)
        }
        .buttonStyle(.plain)
        .disabled(!ready)
    }

    private var banButton: some View {
        Button {
            onBan(reason)
        } label: {
            Text("moderation_ban")
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

    /// One of the moderator's plain answers, as an outlined pill.
    private func verb(_ label: LocalizedStringKey, _ action: ModerationVerb) -> some View {
        Button {
            Task { await model.act(report, action, reason: reason) }
        } label: {
            PillLabel(text: label, filled: false, wide: false)
        }
        .buttonStyle(.plain)
        .disabled(!ready)
    }

    private func periodLabel(_ period: MutePeriod) -> LocalizedStringKey {
        switch period {
        case .day: "moderation_mute_day"
        case .week: "moderation_mute_week"
        case .month: "moderation_mute_month"
        }
    }
}
