import SwiftUI

/// A community, a post, a report queue or a person, with the model the root keeps for it while its route is open.
struct SocialDestination: View {
    let route: SocialRoute
    let social: Social
    let models: RouteModels

    var body: some View {
        switch route {
        case .community(let id):
            CommunityView(
                model: models.model(for: route) { CommunityModel(social: social, communityId: id) }, social: social
            ).bellInNavigationBar().id(route)
        case .post(let id):
            PostView(model: models.model(for: route) { PostModel(social: social, postId: id) }, social: social)
                .id(route)
        case .reports(let id):
            ReportsView(model: models.model(for: route) { ReportsModel(social: social, communityId: id) }).id(route)
        case .requests(let id):
            JoinRequestsView(model: models.model(for: route) { JoinRequestsModel(social: social, communityId: id) })
                .id(route)
        case .statements:
            StatementsView(model: models.model(for: route) { StatementsModel(social: social) }).id(route)
        case .person(let id):
            PersonView(model: models.model(for: route) { PersonModel(social: social, accountId: id) }, social: social)
                .id(route)
        }
    }
}
