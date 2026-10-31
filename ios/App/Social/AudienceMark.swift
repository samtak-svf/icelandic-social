import SpjallCore
import SwiftUI

/// Who may read a wall post (decision 0115): a small icon beside its age, named for VoiceOver.
struct AudienceMark: View {
    let audience: WallAudience

    /// Each audience its own icon and name; a new one fails to compile here rather than showing as another.
    private var look: (icon: String, name: LocalizedStringKey) {
        switch audience {
        case .everyone: ("globe", "wall_audience_everyone")
        case .friends: ("person.2.fill", "wall_audience_friends")
        }
    }

    var body: some View {
        Image(systemName: look.icon)
            .font(.system(size: 9, weight: .semibold))
            .accessibilityElement()
            .accessibilityLabel(Text(look.name))
    }
}
