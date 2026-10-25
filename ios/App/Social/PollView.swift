import SpjallCore
import SwiftUI

/// Whether the core sent the counts, which it does only where this account may see them (decision 0090): after it
/// voted, for its author and moderators, and once the poll is closed. One count missing means none is shown.
func pollShowsResults(_ poll: Poll) -> Bool {
    poll.options.allSatisfy { $0.votes != nil }
}

/// A whole percentage of `votes` in `total`; 0 for an empty poll.
func pollShare(votes: UInt64, total: UInt64) -> Int {
    total == 0 ? 0 : Int((Double(votes) / Double(total) * 100).rounded())
}

/// Runs one poll action (a vote, taking it back, closing) and says what came of it: the post as the server sent it
/// back, or the problem, with the post read again when the poll was closed meanwhile so its results show. One
/// place for every screen that votes: a community, a post, the hub's feed.
@MainActor
func runPollAction(
    _ social: Social, postId: String, _ act: @escaping @Sendable () throws -> Post
) async -> (post: Post?, problem: Problem?) {
    do {
        return (try await offMain(act), nil)
    } catch {
        var fresh: Post?
        if case CoreError.Refused(_, "poll_closed", _) = error {
            fresh = try? await offMain({ try social.post(postId) })
        }
        return (fresh, Problem(error))
    }
}

/// The poll on a post card or a post (decision 0090): the options as choices, a bar and a count on each once the
/// results are shown, the total, whether it is closed, and a way to take the vote back. Nothing here says who voted.
struct PollView: View {
    let poll: Poll
    let question: String
    /// This account may vote: it writes here.
    let canVote: Bool
    let onVote: (String) -> Void
    let onWithdraw: () -> Void

    var body: some View {
        let results = pollShowsResults(poll)
        VStack(alignment: .leading, spacing: 8) {
            ForEach(poll.options, id: \.optionId) { option in
                optionRow(option, results: results)
            }
            HStack(spacing: 8) {
                Text(verbatim: plural("poll_votes", Int(poll.total)))
                    .font(.sans(13))
                    .foregroundStyle(BrandTokens.Colors.mutedFg)
                if poll.closed {
                    Text("poll_closed")
                        .font(.sans(13, black: true))
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                }
                Spacer(minLength: 8)
                if canVote, !poll.closed, poll.mine != nil {
                    Button(action: onWithdraw) {
                        Text("poll_withdraw")
                            .font(.sans(13, black: true))
                            .foregroundStyle(BrandTokens.Colors.primary)
                            .frame(minHeight: 36)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: question))
    }

    private func optionRow(_ option: PollOption, results: Bool) -> some View {
        let mine = poll.mine == option.optionId
        let percent = pollShare(votes: option.votes ?? 0, total: poll.total)
        return Button {
            onVote(option.optionId)
        } label: {
            HStack(spacing: 8) {
                Text(verbatim: option.text)
                    .font(.sans(14, black: mine))
                    .foregroundStyle(BrandTokens.Colors.fg)
                    .multilineTextAlignment(.leading)
                if mine {
                    Image(systemName: "checkmark").font(.system(size: 12, weight: .bold))
                        .foregroundStyle(BrandTokens.Colors.primary)
                        .accessibilityHidden(true)
                }
                Spacer(minLength: 8)
                if results, let votes = option.votes {
                    Text(verbatim: "\(votes) · \(percent) %")
                        .font(.sans(13))
                        .monospacedDigit()
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                }
            }
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(alignment: .leading) {
                if results {
                    Rectangle().fill(BrandTokens.Colors.muted)
                        .scaleEffect(x: CGFloat(percent) / 100, anchor: .leading)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay {
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(mine ? BrandTokens.Colors.primary : BrandTokens.Colors.border, lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .disabled(!canVote || poll.closed || mine)
        .accessibilityLabel(Text(verbatim: option.text))
        .accessibilityValue(mine ? Text("poll_your_choice") : Text(verbatim: ""))
        .accessibilityAddTraits(mine ? [.isButton, .isSelected] : .isButton)
    }
}
