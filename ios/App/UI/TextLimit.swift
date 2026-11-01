/// A text's length as the server counts it: code points (decision 0123). `String.count` counts what
/// the screen draws as one character and `utf16.count` counts UTF-16 units, and neither is the
/// server's number.
nonisolated func textLength(_ text: String) -> Int { text.unicodeScalars.count }

/// What is kept of `text` at `limit` code points.
nonisolated func clippedText(_ text: String, to limit: Int) -> String {
    String(String.UnicodeScalarView(text.unicodeScalars.prefix(limit)))
}
