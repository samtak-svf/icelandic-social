import SwiftUI

extension View {
    /// What every screen of a hosted stack reads: the bell, the images a post card draws, the sharing of a post, and
    /// the suspension. The notice and the disabled controls belong to the hosted screens; a conversation is never
    /// refused (0115).
    func hosted(bell: Bell, social: Social, sharing: PostSharing, suspension: SuspensionModel) -> some View {
        environment(\.bell, bell)
            .environment(\.postImages, PostImages(social: social))
            .environment(\.postSharing, sharing)
            .suspensionHost(suspension)
    }
}
