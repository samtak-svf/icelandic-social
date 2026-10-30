import SwiftUI

struct ConversationRoute: View {
    let model: ConversationModel

    var body: some View {
        ConversationView(model: model)
    }
}
