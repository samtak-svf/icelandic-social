import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

public typealias Health = Components.Schemas.Health

/// `GET /health` through the client generated from api/openapi.json.
///
/// A class, so the generated `Client` stays behind a reference: as a struct
/// its layout reaches the app, which then needs OpenAPIRuntime's type
/// metadata without linking that library.
public final class HealthClient: Sendable {
    private let client: Client

    public init(baseURL: URL) {
        client = Client(serverURL: baseURL, transport: URLSessionTransport())
    }

    public func fetch() async throws -> Health {
        try await client.getHealth().ok.body.json
    }
}
