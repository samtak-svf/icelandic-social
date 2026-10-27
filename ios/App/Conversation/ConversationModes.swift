import SpjallCore

extension ConversationModel {
    /// What the composer's text does when sent.
    enum Mode: Equatable {
        case new
        case reply(Item)
        case edit(Item)

        var isEdit: Bool {
            if case .edit = self { true } else { false }
        }
    }

    /// A photo or file of the timeline, by seq.
    enum Media: Equatable {
        case loading
        case ready(String)
        case failed
    }
}
