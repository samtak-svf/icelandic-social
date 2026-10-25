import XCTest

/// The devices the app is built for (decision 0087): an iPad runs it natively, so it gets the layouts of its size
/// class rather than a phone's window, and it turns every way, as split view and Slide Over require. The phone stays
/// upright.
final class DeviceTests: XCTestCase {
    /// The built Info.plist as written: `Bundle` resolves `~ipad` and `~iphone` keys for the device the tests run
    /// on and hides the other's.
    private let plist: [String: Any] = {
        guard let url = Bundle.main.url(forResource: "Info", withExtension: "plist"),
            let dictionary = NSDictionary(contentsOf: url) as? [String: Any]
        else { return [:] }
        return dictionary
    }()

    private func info(_ key: String) -> Any? { plist[key] }

    func testTheAppIsBuiltForThePhoneAndTheIPad() {
        let families = info("UIDeviceFamily") as? [Int] ?? []
        XCTAssertEqual(Set(families), [1, 2], "1 is the iPhone, 2 the iPad")
    }

    func testAnIPadTurnsEveryWay() {
        let orientations = info("UISupportedInterfaceOrientations~ipad") as? [String] ?? []
        XCTAssertEqual(
            Set(orientations),
            [
                "UIInterfaceOrientationPortrait", "UIInterfaceOrientationPortraitUpsideDown",
                "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight",
            ])
        XCTAssertNotEqual(info("UIRequiresFullScreen") as? Bool, true, "full screen only would rule out split view")
    }

    func testThePhoneStaysUpright() {
        let orientations =
            info("UISupportedInterfaceOrientations~iphone") as? [String]
            ?? info("UISupportedInterfaceOrientations") as? [String] ?? []
        XCTAssertEqual(orientations, ["UIInterfaceOrientationPortrait"])
    }
}
