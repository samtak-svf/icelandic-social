import SpjallCore
import XCTest

@testable import Spjall

/// Decision 0125: the faces under a message. The core says who; the screen only cuts the row and words it.
final class ReadFacesTests: XCTestCase {
    private func people(_ count: Int) -> [Person] {
        (1...max(count, 1)).prefix(count).map { person("a\($0)", "Nafn\($0)") }
    }

    func testNoFacesWhenNoOneHasRead() {
        let split = readFaces([])
        XCTAssertEqual(split.shown.count, 0)
        XCTAssertEqual(split.more, 0)
    }

    func testOneToFourShowEveryFaceAndNoCount() {
        for count in 1...4 {
            let split = readFaces(people(count))
            XCTAssertEqual(split.shown.count, count)
            XCTAssertEqual(split.more, 0)
        }
    }

    func testFiveOrMoreShowFourAndTheRestAsACount() {
        let split = readFaces(people(7))
        XCTAssertEqual(split.shown.map(\.account), ["a1", "a2", "a3", "a4"])
        XCTAssertEqual(split.more, 3)
        XCTAssertEqual(readFaces(people(5)).more, 1)
    }

    func testTheLabelNamesEveryoneIncludingThoseBehindTheCount() {
        let line = readFacesLine(people(6))
        for number in 1...6 { XCTAssertTrue(line.contains("Nafn\(number)"), "\(line) names Nafn\(number)") }
        XCTAssertEqual(line, localized("read_by_faces", names(people(6))))
    }

    func testAOneToOneKeepsTheWordAndAGroupDropsIt() {
        XCTAssertEqual(readWordCount(2, group: false), 2)
        XCTAssertNil(readWordCount(2, group: true))
        XCTAssertNil(readWordCount(nil, group: false))
        // The word itself is unchanged for a 1:1.
        XCTAssertEqual(meta(item(1, own: true, readBy: 1), readBy: readWordCount(1, group: false)), [.read])
        XCTAssertEqual(meta(item(1, own: true, readBy: 1), readBy: readWordCount(1, group: true)), [])
        XCTAssertEqual(readMarker(1, group: false), localized("read_marker"))
    }

    func testTheCoreDecidesWhoSoTheItemCarriesThePeopleAsGiven() {
        let reader = person("a3", "Katla")
        let read = item(1, sender: person("a2", "Anna"), readHere: [reader])
        XCTAssertEqual(read.readHere.map(\.account), ["a3"])
        XCTAssertTrue(item(2).readHere.isEmpty)
    }
}
