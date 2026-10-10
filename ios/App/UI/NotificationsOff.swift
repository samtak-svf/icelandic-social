import SwiftUI
import UIKit

/// Notifications are off: nothing new shows until the app is opened. It cannot be dismissed: a messenger
/// whose notifications are off fails silently, so it shows until they are on again.
struct NotificationsOff: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "bell.slash")
                .font(.system(size: 16))
                .foregroundStyle(BrandTokens.Colors.fg)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text("notifications_off")
                    .font(.sans(12.5, relativeTo: .subheadline))
                    .foregroundStyle(BrandTokens.Colors.fg)
                Button {
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                } label: {
                    Text("notifications_settings")
                        .font(.sans(13.5, black: true))
                        .foregroundStyle(BrandTokens.Colors.primary)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .padding(.bottom, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandTokens.Colors.secondarySubtle, in: RoundedRectangle(cornerRadius: 14))
    }
}
