import CoreLocation
import SpjallCore
import SwiftUI

/// The place the phone found, as the body that sends it (decision 0059): microdegrees, rounded, and
/// the accuracy in whole metres when the fix has one (a negative accuracy means it has none).
func locationBody(latitude: Double, longitude: Double, accuracy: Double) -> Body {
    .location(
        latE6: Int32((latitude * 1e6).rounded()),
        lonE6: Int32((longitude * 1e6).rounded()),
        accuracy: wholeMetres(accuracy)
    )
}

/// A fix's accuracy in whole metres, or nil when it has none.
func wholeMetres(_ accuracy: Double) -> UInt32? {
    accuracy >= 0 ? UInt32(min(accuracy.rounded(), Double(UInt32.max))) : nil
}

/// The card's coordinates line (decision 0059): the core's degrees, with the decimal comma, each
/// named by its side of the equator and of Greenwich.
func coordinatesLine(_ links: PlaceLinks) -> String {
    localized(
        "location_coordinates",
        localized(links.north ? "location_north" : "location_south", links.latitude),
        localized(links.east ? "location_east" : "location_west", links.longitude)
    )
}

/// How close the fix is, when it says.
func accuracyLine(_ metres: UInt32?) -> String? {
    metres.map { localized("location_accuracy", Int($0)) }
}

/// A location in a bubble (decision 0059): a pin, the coordinates and the accuracy. No map: nothing is
/// fetched to draw it. A tap opens it on map.is or in Apple Maps, or straight in Apple Maps where
/// map.is has nothing to show.
struct LocationCard: View {
    let latE6: Int32
    let lonE6: Int32
    let accuracy: UInt32?
    let foreground: Color

    @State private var choosing = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        let links = placeLinks(latE6: latE6, lonE6: lonE6)
        let coordinates = coordinatesLine(links)
        Button {
            if links.mapIs == nil { open(links.appleMaps) } else { choosing = true }
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "mappin.and.ellipse").font(.title2).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("location").font(TypeStyle.bubble).fontWeight(.semibold)
                    Text(verbatim: coordinates).font(.footnote)
                    if let line = accuracyLine(accuracy) { Text(verbatim: line).font(.footnote) }
                }
            }
            .frame(minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(foreground)
        .accessibilityLabel(Text(verbatim: "\(localized("location")), \(coordinates)"))
        .confirmationDialog("location", isPresented: $choosing, titleVisibility: .hidden) {
            if let mapIs = links.mapIs { Button("location_open_map_is") { open(mapIs) } }
            Button("location_open_maps") { open(links.appleMaps) }
            Button("cancel", role: .cancel) {}
        }
    }

    private func open(_ link: String) {
        if let url = URL(string: link) { openURL(url) }
    }
}

/// One fresh fix of where the phone is (decision 0059). Location is asked for, while in use, only when
/// the person chooses to send it, and a fix that takes longer than `patience` is not found.
@MainActor
final class Locator: NSObject, @preconcurrency CLLocationManagerDelegate {
    enum Outcome {
        case found(CLLocation)
        case denied
        case notFound
    }

    static let patience: Duration = .seconds(30)

    /// Made on the first ask, so a view that holds a locator costs nothing until then.
    private var manager: CLLocationManager?
    private var waiting: CheckedContinuation<Outcome, Never>?
    private var timeout: Task<Void, Never>?
    /// A fix was asked for; the authorization callback that follows does not ask again.
    private var requested = false

    func locate() async -> Outcome {
        // A second ask ends the first.
        finish(.notFound)
        let manager = manager ?? CLLocationManager()
        self.manager = manager
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        return await withCheckedContinuation { continuation in
            waiting = continuation
            timeout = Task { [weak self] in
                try? await Task.sleep(for: Self.patience)
                guard !Task.isCancelled else { return }
                self?.finish(.notFound)
            }
            ask(manager)
        }
    }

    private func ask(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            finish(.denied)
        default:
            guard !requested else { return }
            requested = true
            manager.requestLocation()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard waiting != nil, manager.authorizationStatus != .notDetermined else { return }
        ask(manager)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let location = locations.last { finish(.found(location)) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finish((error as? CLError)?.code == .denied ? .denied : .notFound)
    }

    private func finish(_ outcome: Outcome) {
        timeout?.cancel()
        timeout = nil
        requested = false
        waiting?.resume(returning: outcome)
        waiting = nil
    }
}
