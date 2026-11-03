import SpjallCore

/// Marks a conversation read up to the newest item a person has seen. Read means seen (#554): while the
/// screen is not `shown`, a timeline that arrives is loaded but marks nothing, so the sender is not told
/// otherwise. A mark only moves forward, and `mark` runs once per new newest item.
@MainActor
final class ReadMarker {
    /// Whether the screen is in front of the person.
    var shown = false
    private var marked: UInt64?
    private let mark: @MainActor (UInt64) async throws -> Void

    /// `mark` sends the read marker for a sequence number, and throws when it did not go.
    init(mark: @escaping @MainActor (UInt64) async throws -> Void) {
        self.mark = mark
    }

    /// Marks everything up to the newest of `items` read, when the screen is shown and that moved on.
    func read(_ items: [Item]) async {
        guard shown, let newest = items.compactMap(\.seq).max() else { return }
        if let marked, newest <= marked { return }
        // Claimed before the call, so two reads at once mark it once; a failed mark gives the claim back.
        let previous = marked
        marked = newest
        do { try await mark(newest) } catch { if marked == newest { marked = previous } }
    }
}
