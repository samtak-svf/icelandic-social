import XCTest

@testable import Spjall

/// The web links a text message underlines and opens (decision 0046).
final class LinksTests: XCTestCase {
    private func found(_ text: String) -> [String] { webLinks(text).map(\.written) }
    private func opened(_ text: String) -> [String] { webLinks(text).map(\.url.absoluteString) }

    func testAnHttpOrHttpsLinkIsFoundAsWritten() {
        XCTAssertEqual(found("sjá http://example.com/a hér"), ["http://example.com/a"])
        XCTAssertEqual(opened("sjá http://example.com/a hér"), ["http://example.com/a"])
        XCTAssertEqual(found("https://example.com/a?b=c#d"), ["https://example.com/a?b=c#d"])
    }

    func testAWwwLinkOpensOverHttps() {
        XCTAssertEqual(found("á www.example.com/x"), ["www.example.com/x"])
        XCTAssertEqual(opened("á www.example.com/x"), ["https://www.example.com/x"])
    }

    func testTheSentencesPunctuationIsNotPartOfTheLink() {
        XCTAssertEqual(found("Sjáðu https://example.com."), ["https://example.com"])
        XCTAssertEqual(found("https://example.com/a, og"), ["https://example.com/a"])
        XCTAssertEqual(found("Hvað með https://example.com?!"), ["https://example.com"])
        XCTAssertEqual(found("https://example.com;:"), ["https://example.com"])
    }

    func testABalancedBracketStaysAndAnUnbalancedOneGoes() {
        let wiki = "https://en.wikipedia.org/wiki/Foo_(bar)"
        XCTAssertEqual(found(wiki), [wiki])
        XCTAssertEqual(found("(\(wiki))"), [wiki])
        XCTAssertEqual(found("(sjá https://example.com/a)"), ["https://example.com/a"])
        XCTAssertEqual(found("(https://example.com/a)."), ["https://example.com/a"])
        XCTAssertEqual(found("[https://example.com/a]"), ["https://example.com/a"])
    }

    func testAClosingQuoteAtTheEndGoes() {
        XCTAssertEqual(found("\"https://example.com\""), ["https://example.com"])
        XCTAssertEqual(found("'https://example.com'"), ["https://example.com"])
        XCTAssertEqual(found("“https://example.com”"), ["https://example.com"])
        XCTAssertEqual(found("„https://example.com“"), ["https://example.com"])
        XCTAssertEqual(found("«https://example.com»"), ["https://example.com"])
    }

    func testTwoLinksAreBothFoundInOrder() {
        let text = "fyrst https://a.example.is og svo www.b.example.is."
        XCTAssertEqual(found(text), ["https://a.example.is", "www.b.example.is"])
        let links = webLinks(text)
        XCTAssertEqual(String(text[links[0].range]), "https://a.example.is")
        XCTAssertEqual(String(text[links[1].range]), "www.b.example.is")
    }

    func testTextWithoutALinkHasNone() {
        XCTAssertEqual(found("Sæl, hvað segirðu?"), [])
        XCTAssertEqual(found(""), [])
        XCTAssertEqual(found("bara http:// og www."), [])
        XCTAssertEqual(found("foohttps://example.com"), [])
        XCTAssertEqual(found("example.com"), [])
    }

    func testTheSchemeMatchesInAnyCase() {
        XCTAssertEqual(found("HTTPS://Example.com/A"), ["HTTPS://Example.com/A"])
        XCTAssertEqual(opened("HTTPS://Example.com/A"), ["https://Example.com/A"])
        XCTAssertEqual(opened("WWW.example.com"), ["https://www.example.com"])
    }

    func testTheLinkedTextKeepsEveryCharacterAndLinksOnlyTheLinks() {
        let text = "sjá https://example.com."
        let attributed = linked(text, webLinks(text), foreground: .black)
        XCTAssertEqual(String(attributed.characters), text)
        XCTAssertEqual(attributed.runs.compactMap { $0.link?.absoluteString }, ["https://example.com"])
    }
}
