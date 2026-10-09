import Foundation
import SpjallCore

/// The core's HTTP (decision 0018): it builds every request and reads every
/// answer, and this only carries them. The core calls it on the thread that
/// called the core, never the main one, so it blocks. Any status is an answer
/// and goes back to the core as one; only no answer at all is `Unreachable`.
/// Nothing here logs: the bearer is a device token, and paths can carry an
/// invite token. Files (decision 0023) go by path both ways and are
/// streamed, never held whole. A 426 also goes to `tooOld` with the minimum
/// version (decision 0030), since the core meets it on paths whose errors the
/// app never sees.
final class URLSessionTransport: Transport, Sendable {
    private let base: String
    private let session: URLSession
    private let tooOld: @Sendable (String) -> Void

    init(
        baseURL: URL,
        session: URLSession = URLSession(configuration: .ephemeral),
        tooOld: @escaping @Sendable (String) -> Void = { _ in }
    ) {
        var base = baseURL.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        self.base = base
        self.session = session
        self.tooOld = tooOld
    }

    func request(request: HttpRequest) throws -> HttpResponse {
        var call = try urlRequest(request)
        if let body = request.body {
            call.httpBody = Data(body.utf8)
            call.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return try carry { done in session.dataTask(with: call, completionHandler: done) }
    }

    func upload(request: HttpRequest, path: String) throws -> HttpResponse {
        var call = try urlRequest(request)
        call.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        return try carry { done in
            session.uploadTask(with: call, fromFile: URL(filePath: path), completionHandler: done)
        }
    }

    func download(request: HttpRequest, to: String) throws -> HttpResponse {
        let call = try urlRequest(request)
        return try carry { done in
            session.downloadTask(with: call) { location, response, error in
                // Only a 200 is the file; any other answer is the core's to read.
                guard let location, (response as? HTTPURLResponse)?.statusCode == 200 else {
                    return done(location.flatMap { try? Data(contentsOf: $0) }, response, error)
                }
                do {
                    let target = URL(filePath: to)
                    try? FileManager.default.removeItem(at: target)
                    try FileManager.default.moveItem(at: location, to: target)
                    done(nil, response, nil)
                } catch {
                    done(nil, nil, URLError(.cannotMoveFile))
                }
            }
        }
    }

    private func urlRequest(_ request: HttpRequest) throws -> URLRequest {
        guard let url = URL(string: base + request.path) else {
            throw TransportError.Unreachable(detail: "bad path")
        }
        var call = URLRequest(url: url)
        call.httpMethod =
            switch request.method {
            case .get: "GET"
            case .post: "POST"
            case .put: "PUT"
            case .delete: "DELETE"
            }
        if let bearer = request.bearer {
            call.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        }
        if let client = request.client {
            call.setValue(client, forHTTPHeaderField: "Spjall-Client")
        }
        return call
    }

    /// Starts the task `start` makes and waits for its answer.
    private func carry(
        _ start: (@escaping @Sendable (Data?, URLResponse?, Error?) -> Void) -> URLSessionTask
    ) throws -> HttpResponse {
        let answer = Answer()
        let done = DispatchSemaphore(value: 0)
        start { data, response, error in
            answer.set(data: data, response: response, error: error)
            done.signal()
        }.resume()
        done.wait()
        let response = try answer.result()
        if response.status == 426, let min = Self.minVersion(response.body) { tooOld(min) }
        return response
    }

    private static func minVersion(_ body: String) -> String? {
        let answer = try? JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any]
        return (answer?["minVersion"] as? String).flatMap { $0.isEmpty ? nil : $0 }
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
