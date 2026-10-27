import SpjallCore
import SwiftUI

/// The picker, with a model of its own each time it opens.
struct PeopleRoute: View {
    @State private var model: PeopleModel
    let onInvite: () -> Void
    let onOpened: (String) -> Void

    init(account: Account, live: Live, onInvite: @escaping () -> Void, onOpened: @escaping (String) -> Void) {
        _model = State(initialValue: PeopleModel(account: account, live: live))
        self.onInvite = onInvite
        self.onOpened = onOpened
    }

    var body: some View {
        PeopleView(model: model, onInvite: onInvite)
            .onChange(of: model.opened) { _, id in
                if let id { onOpened(id) }
            }
    }
}

/// A conversation, with the model the root keeps for it.
