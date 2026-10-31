import SpjallCore
import SwiftUI

extension View {
    /// Makes an author's photo or name open their person screen (decision 0114). An anonymous post names nobody
    /// (decision 0091), and an author the server no longer has cannot be opened, so those stay plain.
    @ViewBuilder
    func personLink(_ author: Author?, anonymous: Bool) -> some View {
        if let author, !anonymous {
            NavigationLink(value: SocialRoute.person(author.accountId)) { self }.buttonStyle(.plain)
        } else {
            self
        }
    }
}
