import SpjallCore
import SwiftUI

/// Who wrote it (their photo and name open their person screen), the verified mark, a badge for an owner or a
/// moderator, and when. A post seen outside its community (`community`: the feeds) names the community first, with
/// its picture carrying the author's small one, and the author below; inside one, or on a wall, the author is the
/// only name (decision 0116). `audience` marks a wall post; `menu` is what the card offers at the row's end.
/// `short` writes the age as "6 klst." (decision 0080).
struct Byline<Menu: View>: View {
    let author: Author?
    /// The name an anonymous post shows in place of its author's (decision 0091).
    var anonymousName: String?
    let createdAt: UInt64
    var community: Community?
    /// Who may read a wall post; nil elsewhere.
    var audience: WallAudience?
    var short = false
    let menu: Menu

    init(
        author: Author?, anonymousName: String? = nil, createdAt: UInt64, community: Community? = nil,
        audience: WallAudience? = nil, short: Bool = false, @ViewBuilder menu: () -> Menu
    ) {
        self.audience = audience
        self.author = author
        self.anonymousName = anonymousName
        self.createdAt = createdAt
        self.community = community
        self.short = short
        self.menu = menu()
    }

    /// The name and the badge, which goes below the name when both do not fit on a line.
    @ViewBuilder private var byline: some View {
        NameWithMark(
            name: anonymousName ?? authorName(author), verified: author?.verified == true, markSize: 12,
            font: .sans(14, black: true))
        RoleBadge(role: author?.role)
    }

    /// The age, and who may read it where that is a wall's choice (decision 0115).
    private var meta: some View {
        HStack(spacing: 4) {
            Text(verbatim: short ? relativeTime(createdAt) : postedAt(createdAt))
            if let audience { AudienceMark(audience: audience) }
        }
        .font(TypeStyle.meta)
        .foregroundStyle(BrandTokens.Colors.mutedFg)
    }

    private var person: some View {
        Avatar(
            name: author?.name, kind: author?.verified == true ? .verified : .unverified,
            size: community == nil ? 34 : 18, photo: author?.photoOf
        ).personLink(author, anonymous: anonymousName != nil)
    }

    private var nameLine: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 4) { byline }
            VStack(alignment: .leading, spacing: 2) { byline }
        }.personLink(author, anonymous: anonymousName != nil)
    }

    var body: some View {
        HStack(spacing: 10) {
            if let community {
                // Away from its community a post names the community first, its picture carrying the author's
                // small one; the author is the line below (decision 0116).
                CommunityBadge(community: community, size: 38)
                    .overlay(alignment: .bottomTrailing) { person.offset(x: 5, y: 5) }
                    .padding(.trailing, 4)
                VStack(alignment: .leading, spacing: 2) {
                    NavigationLink(value: SocialRoute.community(community.communityId)) {
                        Text(verbatim: community.name).font(.sans(14, black: true)).lineLimit(2)
                    }.buttonStyle(.plain)
                    nameLine
                    meta
                }
            } else {
                person
                VStack(alignment: .leading, spacing: 2) {
                    nameLine
                    meta
                }
            }
            Spacer(minLength: 8)
            menu
        }
    }
}

/// `Eigandi` or `Stjórnandi` beside a name; nothing for a member, for no role and for a role a newer server added
/// (decision 0080).
struct RoleBadge: View {
    let role: AuthorRole?

    var body: some View {
        if let key = key {
            Text(key)
                .font(.sans(10.5, black: true))
                .foregroundStyle(BrandTokens.Colors.mutedFg)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(BrandTokens.Colors.muted, in: Capsule())
        }
    }

    private var key: LocalizedStringKey? {
        switch role {
        case .owner: LocalizedStringKey("community_role_owner")
        case .moderator: LocalizedStringKey("community_role_moderator")
        case .unknown, nil: nil
        }
    }
}

extension Byline where Menu == EmptyView {
    /// A byline with nothing to offer at its end.
    init(author: Author?, createdAt: UInt64, community: Community? = nil, short: Bool = false) {
        self.init(author: author, createdAt: createdAt, community: community, short: short) { EmptyView() }
    }
}
