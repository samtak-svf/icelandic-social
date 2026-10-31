import SwiftUI

/// Settings, suggestions (decision 0114): one switch that works both ways.
struct SuggestionSettingsSection: View {
    let model: SuggestionSettingsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CardLabel(key: "suggestions_setting_title")
            if let included = model.included {
                Panel {
                    Toggle(
                        isOn: Binding(get: { included }, set: { value in Task { await model.set(value) } })
                    ) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("suggestions_setting_label")
                                .font(.sans(14, black: true))
                                .foregroundStyle(BrandTokens.Colors.fg)
                            Text("suggestions_setting_hint")
                                .font(.sans(12, relativeTo: .footnote))
                                .foregroundStyle(BrandTokens.Colors.mutedFg)
                        }
                    }
                    .tint(BrandTokens.Colors.primary)
                    .disabled(model.busy)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 48)
                }
            }
            if let problem = model.problem {
                ProblemCard(problem: problem) { Task { await model.load() } }
            }
        }
        .task { await model.load() }
    }
}
