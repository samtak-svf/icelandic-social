import Foundation

/// The models of the screens a navigation stack holds open, kept by the root rather than by the screens
/// (decision 0087). A window that changes size class swaps its container (a bar under the screens for a rail beside
/// them), and a screen's own `@State` lives only as long as the view that owns it: a model made here survives that,
/// so the open community, a half-written post and a half-written message are still there. Keyed by the route that
/// opened the screen; `keep` lets go of the models whose route has left every stack, so a screen opened again later
/// starts fresh, as it always did.
@MainActor
final class RouteModels {
    private var models: [AnyHashable: AnyObject] = [:]

    /// How many models are held, for the tests.
    var count: Int { models.count }

    /// The model for `route`: the one made before, or `make()`'s.
    func model<Route: Hashable, Model: AnyObject>(for route: Route, make: () -> Model) -> Model {
        if let held = models[route] as? Model { return held }
        let made = make()
        models[route] = made
        return made
    }

    /// Lets go of every model whose route is not among `routes`.
    func keep(_ routes: Set<AnyHashable>) {
        models = models.filter { routes.contains($0.key) }
    }
}
