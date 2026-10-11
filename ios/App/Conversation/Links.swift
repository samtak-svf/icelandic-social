import Foundation
import SwiftUI

/// A web link in a message's text (decision 0046): where it is written, and what a tap opens.
struct WebLink: Equatable {
    let range: Range<String.Index>
    /// The link as written, which the screen reader's action names.
    let written: String
    let url: URL
}

/// The web links in `text` (decision 0046): each a run of non-space characters
/// starting with `http://`, `https://` or `www.`, in any case, at the start of
/// a word. Punctuation that ends the sentence (`.,;:!?`) is not part of it, nor
/// is a closing bracket or quote whose opening one is not in the link, so
/// `(see https://x.is)` gives `https://x.is` and a link with a balanced `(…)`
/// keeps its `)`. A `www.` link opens as `https://`.
func webLinks(_ text: String) -> [WebLink] {
    var links: [WebLink] = []
    var index = text.startIndex
    while index < text.endIndex {
        guard let prefix = linkPrefix(text, at: index) else {
            index = text.index(after: index)
            continue
        }
        var end = text[index...].firstIndex(where: \.isWhitespace) ?? text.endIndex
        end = trimmed(text, from: index, to: end)
        let written = String(text[index..<end])
        if written.count > prefix.count, let url = linkURL(written, prefix: prefix) {
            links.append(WebLink(range: index..<end, written: written, url: url))
        }
        // Whatever was cut from the end is not the start of another link.
        index = text[end...].firstIndex(where: \.isWhitespace) ?? text.endIndex
    }
    return links
}

private let linkPrefixes = ["https://", "http://", "www."]

/// The prefix a link starts with at `index`, lowercased, when one does and no letter or digit comes right before it.
private func linkPrefix(_ text: String, at index: String.Index) -> String? {
    if index > text.startIndex {
        let before = text[text.index(before: index)]
        if before.isLetter || before.isNumber { return nil }
    }
    let ahead = text[index...].prefix(8).lowercased()
    return linkPrefixes.first { ahead.hasPrefix($0) }
}

/// Closers and the opener each one needs inside the link to stay. A straight quote is its own opener;
/// `“` and `‘` close Icelandic quotes, which open with `„` and `‚`.
private let linkClosers: [Character: Character] = [
    ")": "(",
    "]": "[",
    "}": "{",
    "\"": "\"",
    "'": "'",
    "”": "“",
    "’": "‘",
    "»": "«",
    "“": "„",
    "‘": "‚",
]

/// `end`, moved back past the sentence's punctuation and any closer without its opener in the link.
private func trimmed(_ text: String, from start: String.Index, to end: String.Index) -> String.Index {
    var end = end
    while end > start {
        let last = text[text.index(before: end)]
        let link = text[start..<end]
        if ".,;:!?".contains(last) {
            end = text.index(before: end)
        } else if let opener = linkClosers[last], unpaired(last, opener: opener, in: link) {
            end = text.index(before: end)
        } else {
            break
        }
    }
    return end
}

/// Whether the closing `closer` at the end of `link` has no opener of its own in it.
private func unpaired(_ closer: Character, opener: Character, in link: Substring) -> Bool {
    if closer == opener {
        return link.filter { $0 == closer }.count % 2 == 1
    }
    return link.filter { $0 == closer }.count > link.filter { $0 == opener }.count
}

private func linkURL(_ written: String, prefix: String) -> URL? {
    let rest = written.dropFirst(prefix.count)
    let address = prefix == "www." ? "https://www.\(rest)" : "\(prefix)\(rest)"
    guard let url = URL(string: address), url.host() != nil else { return nil }
    return url
}

/// `text` with its web links set as links and underlined. The text keeps its
/// colour, so the brand's contrast pairs still hold (decision 0046); the view
/// tints links with the same colour.
func linked(_ text: String, _ links: [WebLink], foreground: Color) -> AttributedString {
    var result = AttributedString()
    var cursor = text.startIndex
    for link in links {
        result += AttributedString(String(text[cursor..<link.range.lowerBound]))
        var part = AttributedString(link.written)
        part.link = link.url
        part.underlineStyle = Text.LineStyle.single
        part.foregroundColor = foreground
        result += part
        cursor = link.range.upperBound
    }
    result += AttributedString(String(text[cursor...]))
    return result
}
