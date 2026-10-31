import SpjallCore
import SwiftUI

/// The poll's option fields in the composer (decision 0090): two to six, each up to 80 characters, with a way to add
/// one and to take one out once there are more than two. The post's text above is the question.
struct PollFields: View {
    let model: PostAttachments

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            let fields = model.pollFields ?? []
            ForEach(fields.indices, id: \.self) { index in
                HStack(spacing: 6) {
                    TextField(
                        localized("composer_poll_option", index + 1),
                        text: Binding(
                            get: { model.pollFields?[safe: index] ?? "" },
                            set: { text in
                                guard model.pollFields?.indices.contains(index) == true else { return }
                                model.pollFields?[index] = String(text.prefix(CommunityModel.pollOptionLimit))
                            })
                    )
                    .font(.sans(14))
                    .padding(.horizontal, 12)
                    .frame(minHeight: 40)
                    .background(BrandTokens.Colors.muted, in: RoundedRectangle(cornerRadius: 10))
                    if fields.count > CommunityModel.pollMinOptions {
                        RoundButton(
                            systemImage: "minus.circle", label: "composer_poll_remove_option",
                            fill: BrandTokens.Colors.muted, tint: BrandTokens.Colors.fg, size: 36
                        ) {
                            model.removePollOption(at: index)
                        }
                    }
                }
            }
            if fields.count < CommunityModel.pollMaxOptions {
                Button {
                    model.addPollOption()
                } label: {
                    Label("composer_poll_add_option", systemImage: "plus")
                        .font(.sans(13, black: true))
                        .foregroundStyle(BrandTokens.Colors.primary)
                        .frame(minHeight: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }
}
