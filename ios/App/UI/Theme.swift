import CoreText
import SwiftUI

/// The bundled faces. The generated list names each file in the bundle's
/// Fonts folder and the PostScript name it registers under, so adding a face
/// to the brand needs no edit here or in Info.plist.
enum Typefaces {
    /// Once at launch, before the first screen draws.
    static func register() {
        for face in BrandTokens.FontFiles.sans + BrandTokens.FontFiles.headline {
            guard let url = Bundle.main.url(forResource: face.file, withExtension: nil, subdirectory: "Fonts")
            else { continue }
            // Already registered (a second scene, the test host) is not a problem.
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }

    /// The face of `faces` nearest `weight`, scaled with Dynamic Type as
    /// `style`, or at a fixed size when `style` is nil; the system font at that
    /// weight when the family has none.
    static func font(
        _ faces: [(file: String, name: String, weight: Int)], size: CGFloat, weight: Int,
        relativeTo style: Font.TextStyle?
    ) -> Font {
        guard let face = faces.min(by: { abs($0.weight - weight) < abs($1.weight - weight) }) else {
            return .system(size: size, weight: systemWeight(weight))
        }
        guard let style else { return .custom(face.name, fixedSize: size) }
        return .custom(face.name, size: size, relativeTo: style)
    }

    private static func systemWeight(_ weight: Int) -> Font.Weight {
        switch weight {
        case ..<450: .regular
        case ..<550: .medium
        case ..<650: .semibold
        case ..<750: .bold
        case ..<850: .heavy
        default: .black
        }
    }
}

extension Font {
    static let mediumWeight = 500
    static let blackWeight = 900

    /// The body family: Medium for text, Black for names, labels and actions.
    static func sans(_ size: CGFloat, black: Bool = false, relativeTo style: Font.TextStyle = .body) -> Font {
        Typefaces.font(
            BrandTokens.FontFiles.sans, size: size, weight: black ? blackWeight : mediumWeight, relativeTo: style)
    }

    /// The body family at a size Dynamic Type does not change, for text that must fit a shape that
    /// does not grow, as initials in their circle (0053).
    static func sansFixed(_ size: CGFloat, black: Bool = false) -> Font {
        Typefaces.font(
            BrandTokens.FontFiles.sans, size: size, weight: black ? blackWeight : mediumWeight, relativeTo: nil)
    }

    /// The condensed display family, for screen titles and the account name.
    static func headline(_ size: CGFloat, relativeTo style: Font.TextStyle = .largeTitle) -> Font {
        Typefaces.font(BrandTokens.FontFiles.headline, size: size, weight: 800, relativeTo: style)
    }
}

/// The corner radii, by role. Short, so a call site stays on one line.
typealias Radii = BrandTokens.Radius

/// The type the design repeats, read from the generated tokens. Line heights are not applied: iOS lays text out
/// at the font's own leading.
enum TypeStyle {
    private typealias Tokens = BrandTokens.Typography

    /// A tab's name across the top of its screen, in capitals.
    static let screenTitle = Font.headline(Tokens.screenTitle.size)
    /// The person's own name on "Ég".
    static let accountName = Font.headline(Tokens.accountName.size, relativeTo: .title)
    /// Small capitals over a section or a day; tracked by `sectionTracking`.
    static let sectionLabel = Font.sans(
        Tokens.sectionLabel.size, black: Tokens.sectionLabel.weight == 900, relativeTo: .caption2)
    static let sectionTracking: CGFloat = Tokens.sectionLabel.tracking
    /// A message's text.
    static let bubble = Font.sans(Tokens.bubble.size, relativeTo: .body)
    /// The time and read line under a message, a sender's name in a group.
    static let meta = Font.sans(Tokens.meta.size, black: Tokens.meta.weight == 900, relativeTo: .caption2)
}
