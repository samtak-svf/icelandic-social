/// Where a hosted screen leads: a community, a post, a community's report queue, the statements, or a person.
enum SocialRoute: Hashable {
    case community(String)
    case post(String)
    case reports(String)
    case requests(String)
    case statements
    case person(String)
}
