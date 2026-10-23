import SpjallCore
import SwiftUI

/// What the person sees before approving a browser (decision 0077): which browser it is, and how much of
/// the history goes with it.
struct LinkApproveView: View {
    let model: LinkModel
    let request: LinkRequest

    /// "Firefox on Linux", or the unknown label when the server could not name the browser.
    static func label(_ request: LinkRequest) -> String {
        guard let browser = request.browser else { return localized("session_browser_unknown") }
        return localized("session_browser", browser, request.os ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(verbatim: localized("device_link_approve_body", Self.label(request)))
                .foregroundStyle(BrandTokens.Colors.fg)
            CardLabel(key: "device_link_history_title")
            Panel {
                choice("device_link_history_recent", .recent)
                Hairline()
                choice("device_link_history_all", .all)
                Hairline()
                choice("device_link_history_none", .nothing)
            }
            Button {
                Task { await model.approve() }
            } label: {
                PillLabel(text: "device_link_approve", filled: true)
            }
            .buttonStyle(.plain)
            Spacer()
        }
        .padding(16)
    }

    private func choice(_ key: LocalizedStringKey, _ value: LinkModel.History) -> some View {
        Button {
            model.history = value
        } label: {
            HStack {
                Text(key).foregroundStyle(BrandTokens.Colors.fg)
                Spacer()
                if model.history == value {
                    Image(systemName: "checkmark").foregroundStyle(BrandTokens.Colors.primary)
                }
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(model.history == value ? .isSelected : [])
    }
}
