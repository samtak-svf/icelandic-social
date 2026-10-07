import Foundation

/// A brand string with placeholders. The catalogue keys are bare names
/// (`link_invited_by`) whose values hold `%1$@`, so SwiftUI's interpolated
/// keys (`"link_invited_by %@"`) would miss them.
func localized(_ key: String, _ arguments: CVarArg...) -> String {
    String(format: String(localized: String.LocalizationValue(key)), arguments: arguments)
}

/// A brand string with plural variations, in the form for `count`.
func plural(_ key: String, _ count: Int) -> String {
    String.localizedStringWithFormat(NSLocalizedString(key, comment: ""), count)
}
