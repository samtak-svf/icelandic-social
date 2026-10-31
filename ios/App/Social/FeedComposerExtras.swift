import SpjallCore
import SwiftUI

/// What the feed's composer asks besides the words (decision 0116): where the post goes, beside the own wall every
/// community this account may post in; for the wall, who may read it and that it is not encrypted (decision 0115);
/// for a community that allows it, whether to hide the name (decision 0091).
struct FeedComposerExtras: View {
    let model: HomeModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !model.targets.isEmpty { placePicker }
            switch model.place {
            case .wall:
                Picker(
                    "wall_audience_label",
                    selection: Binding(get: { model.audience }, set: { model.audience = $0 })
                ) {
                    Text("wall_audience_friends").tag(WallAudience.friends)
                    Text("wall_audience_everyone").tag(WallAudience.everyone)
                }
                .pickerStyle(.segmented)
                SocialNote(text: "wall_not_encrypted_notice")
            case .community:
                if model.allowsAnonymous {
                    Toggle(isOn: Binding(get: { model.anonymous }, set: { model.anonymous = $0 })) {
                        Text("composer_anonymous").font(.sans(14, black: true))
                    }
                    Text("composer_anonymous_hint")
                        .font(TypeStyle.meta)
                        .foregroundStyle(BrandTokens.Colors.mutedFg)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }

    private var placePicker: some View {
        HStack {
            Text("feed_compose_target").font(.sans(14, black: true))
            Spacer(minLength: 8)
            Picker(
                "feed_compose_target",
                selection: Binding(get: { model.place }, set: { model.place = $0 })
            ) {
                Text("feed_target_wall").tag(HomeModel.Place.wall)
                ForEach(model.targets, id: \.communityId) { community in
                    Text(verbatim: community.name).tag(HomeModel.Place.community(community.communityId))
                }
            }
            .pickerStyle(.menu)
        }
    }
}
