import SwiftUI

/// The Me tab's root (decision 0115): this account's own wall, which is its person screen. The settings the tab
/// held before, with the photo, the devices, the lists and sign out, are one tap away behind the gear.
struct OwnWall: View {
    let me: MeModel
    let social: Social
    let models: RouteModels
    let onSettings: () -> Void

    var body: some View {
        Group {
            if let id = me.me?.accountId {
                let route = SocialRoute.person(id)
                PersonView(
                    model: models.model(for: route) { PersonModel(social: social, accountId: id) }, social: social,
                    onSettings: onSettings, own: me
                )
                .id(id)
            } else {
                VStack(spacing: 0) {
                    ScreenHeader(title: localized("tab_me"))
                    if let problem = me.problem {
                        ProblemCard(problem: problem) { Task { await me.retry() } }.padding(16)
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                    }
                    Spacer(minLength: 0)
                }
                .background(BrandTokens.Colors.bg)
                .toolbar(.hidden, for: .navigationBar)
            }
        }
        .task { if me.me == nil { await me.load() } }
    }
}
