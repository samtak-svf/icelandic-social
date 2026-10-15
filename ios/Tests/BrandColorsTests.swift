import SwiftUI
import UIKit
import XCTest

@testable import Spjall

/// Every brand colour comes from a colour set with a dark appearance
/// (decision 0052). A missing set would fall back silently at run time, so
/// each is looked up by name here.
final class BrandColorsTests: XCTestCase {
    private func resolved(_ color: Color, _ scheme: ColorScheme) -> Color.Resolved {
        var environment = EnvironmentValues()
        environment.colorScheme = scheme
        return color.resolve(in: environment)
    }

    func testEveryColourHasASetWithADarkAppearance() {
        XCTAssertFalse(BrandTokens.Colors.all.isEmpty)
        for name in BrandTokens.Colors.all.keys {
            let light = UITraitCollection(userInterfaceStyle: .light)
            let dark = UITraitCollection(userInterfaceStyle: .dark)
            XCTAssertNotNil(UIColor(named: "Brand/\(name)", in: .main, compatibleWith: light), name)
            XCTAssertNotNil(UIColor(named: "Brand/\(name)", in: .main, compatibleWith: dark), name)
        }
    }

    func testTheScreenFollowsTheMode() {
        for color in [BrandTokens.Colors.surface, BrandTokens.Colors.fg, BrandTokens.Colors.primary] {
            XCTAssertNotEqual(resolved(color, .light), resolved(color, .dark))
        }
    }

    func testTextStaysReadableInBothModes() {
        for scheme in [ColorScheme.light, .dark] {
            let fg = resolved(BrandTokens.Colors.fg, scheme)
            let surface = resolved(BrandTokens.Colors.surface, scheme)
            XCTAssertGreaterThan(abs(luminance(fg) - luminance(surface)), 0.5, "\(scheme)")
        }
    }

    private func luminance(_ color: Color.Resolved) -> Float {
        0.2126 * color.linearRed + 0.7152 * color.linearGreen + 0.0722 * color.linearBlue
    }
}
