import SpjallCore
import SwiftUI

/// How many faces sit under a message before "+N" takes the rest (decision 0125).
private let facesShown = 4

/// The faces to draw under a message and how many more there are. The core says who (decision 0125); nothing
/// is worked out here, only where the row is cut.
func readFaces(_ people: [Person]) -> (shown: [Person], more: Int) {
    (Array(people.prefix(facesShown)), max(0, people.count - facesShown))
}

/// What VoiceOver says for the row of faces: everyone, those folded into "+N" too (decision 0125).
func readFacesLine(_ people: [Person]) -> String {
    localized("read_by_faces", names(people))
}

/// The count word under the newest own message someone read. A group shows faces instead (decision 0125), so
/// only a 1:1 keeps the word.
func readWordCount(_ readBy: UInt32?, group: Bool) -> UInt32? {
    group ? nil : readBy
}

/// Who has read up to a message in a group (decision 0125): up to four small round faces, then "+N", on a
/// button that opens everyone by name. Nothing is drawn when no one's mark lands here.
struct ReadFaces: View {
    let people: [Person]

    @State private var open = false

    var body: some View {
        if !people.isEmpty {
            let split = readFaces(people)
            Button {
                open = true
            } label: {
                HStack(spacing: 4) {
                    HStack(spacing: -6) {
                        ForEach(split.shown, id: \.account) { person in
                            Avatar(person: person, size: 20)
                                .overlay(Circle().strokeBorder(BrandTokens.Colors.bg, lineWidth: 2))
                        }
                    }
                    if split.more > 0 {
                        Text(verbatim: plural("read_by_more", split.more))
                            .font(TypeStyle.meta)
                            .foregroundStyle(BrandTokens.Colors.mutedFg)
                    }
                }
                .padding(.horizontal, 4)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: readFacesLine(people)))
            .sheet(isPresented: $open) { ReadBySheet(people: people) }
        }
    }
}

/// Everyone who has read, by name, so nobody behind "+N" stays hidden (decision 0125).
struct ReadBySheet: View {
    let people: [Person]

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(people, id: \.account) { person in
                    HStack(spacing: 12) {
                        Avatar(person: person, size: 36)
                        Text(verbatim: shownName(person)).foregroundStyle(BrandTokens.Colors.fg)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(BrandTokens.Colors.surface)
            .navigationTitle(Text("read_by_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("cancel") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Who read the reader's message (decision 0022): "Lesin" in a 1:1, the count in a group; the list's row
/// says the same.
func readMarker(_ count: UInt32, group: Bool) -> String {
    group ? plural("read_by_count", Int(count)) : localized("read_marker")
}

/// The read marker for the reader's own sent `item` that someone read, or nil (decision 0043).
func readLine(_ item: Item, group: Bool) -> String? {
    guard item.own, item.status == .sent, item.readBy > 0 else { return nil }
    return readMarker(item.readBy, group: group)
}
