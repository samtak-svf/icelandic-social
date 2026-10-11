import SwiftUI

/// What moves, under the system's Reduce Motion (decision 0022). Rows animate as the core's events
/// change a list (decision 0043), and placeholder rows pulse, only while motion is not reduced.
enum Motion {
    /// The animation a list's rows get when they change; none under Reduce Motion.
    static func rows(reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .default
    }

    /// Whether placeholder rows pulse; under Reduce Motion they hold still.
    static func pulses(reduceMotion: Bool) -> Bool {
        !reduceMotion
    }
}
