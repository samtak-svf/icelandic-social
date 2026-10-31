import SwiftUI

/// What the conversations' stack leads to: the people, a conversation, or the hosted screen a link in one opened.
struct ConversationsDestination: View {
    let route: SocialRoute
    let account: Account
    let live: Live
    let drafts: Drafts
    let push: PushModel
    let social: Social
    let models: RouteModels
    let onInvite: () -> Void
    let onOpen: (String) -> Void

    var body: some View {
        switch route {
        case .people:
            PeopleRoute(account: account, live: live, onInvite: onInvite, onOpened: onOpen)
        case .conversation(let id):
            let model = models.model(for: route) {
                ConversationModel(id: id, account: account, live: live, drafts: drafts)
            }
            ConversationRoute(model: model)
                .task(id: id) { await push.dismiss(id) }
        default:
            SocialDestination(route: route, social: social, models: models)
        }
    }
}
