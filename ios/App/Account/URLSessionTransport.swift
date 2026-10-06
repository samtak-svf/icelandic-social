import Foundation
import SpjallCore

/// The core's HTTP (decision 0018): it builds every request and reads every
/// answer, and this only carries them. The core calls it on the thread that
/// called the core, never the main one, so it blocks. Any status is an answer
/// and goes back to the core as one; only no answer at all is `Unreachable`.
/// Nothing here logs: the bearer is a device token, and paths can carry an
/// invite token.
final class URLSessionTransport: Transport, Sendable {
    private let base: String
    private let session: URLSession

    init(baseURL: URL, session: URLSession = URLSession(configuration: .ephemeral)) {
        var base = baseURL.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        self.base = base
        self.session = session
    }

    func request(request: HttpRequest) throws -> HttpResponse {
        guard let url = URL(string: base + request.path) else {
            throw TransportError.Unreachable(detail: "bad path")
        }
        var call = URLRequest(url: url)
        call.httpMethod =
            switch request.method {
            case .get: "GET"
            case .post: "POST"
            case .delete: "DELETE"
            }
        if let body = request.body {
            call.httpBody = Data(body.utf8)
            call.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let bearer = request.bearer {
            call.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        }

        let answer = Answer()
        let done = DispatchSemaphore(value: 0)
        session.dataTask(with: call) { data, response, error in
            answer.set(data: data, response: response, error: error)
            done.signal()
        }.resume()
        done.wait()
        return try answer.result()
    }

    /// What came back, handed from URLSession's queue to the waiting thread.
    private final class Answer: @unchecked Sendable {
        private var data: Data?
        private var response: URLResponse?
        private var error: Error?

        func set(data: Data?, response: URLResponse?, error: Error?) {
            self.data = data
            self.response = response
            self.error = error
        }

        func result() throws -> HttpResponse {
            if let error {
                // The error's description can hold the URL, and a path can carry
                // an invite token; its code says what failed without it.
                let code = (error as? URLError)?.code.rawValue ?? 0
                throw TransportError.Unreachable(detail: "URLError \(code)")
            }
            guard let http = response as? HTTPURLResponse else {
                throw TransportError.Unreachable(detail: "not HTTP")
            }
            return HttpResponse(
                status: UInt16(clamping: http.statusCode),
                body: String(decoding: data ?? Data(), as: UTF8.self)
            )
        }
    }
}
