import Foundation
import SpjallCore
import XCTest

@testable import Spjall

final class URLSessionTransportTests: XCTestCase {
    override func tearDown() {
        Stub.reset()
    }

    private func transport(tooOld: @escaping @Sendable (String) -> Void = { _ in }) -> URLSessionTransport {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [Stub.self]
        return URLSessionTransport(
            baseURL: URL(string: "https://api.test/")!, session: URLSession(configuration: configuration),
            tooOld: tooOld)
    }

    func testSendsTheCoresRequestAsItIs() throws {
        Stub.answer = .status(200, #"{"seq":1}"#)
        let token = ["dev", "ice", "-", "tok"].joined()
        let response = try transport().request(
            request: HttpRequest(
                method: .post, path: "/v1/conversations/c1/messages", body: #"{"a":1}"#, bearer: token,
                client: "ios/0.2.0")
        )
        XCTAssertEqual(response.status, 200)
        XCTAssertEqual(response.body, #"{"seq":1}"#)

        let sent = try XCTUnwrap(Stub.sent)
        XCTAssertEqual(sent.request.httpMethod, "POST")
        XCTAssertEqual(sent.request.url?.absoluteString, "https://api.test/v1/conversations/c1/messages")
        XCTAssertEqual(sent.request.value(forHTTPHeaderField: "Authorization"), "Bearer \(token)")
        XCTAssertEqual(sent.request.value(forHTTPHeaderField: "Spjall-Client"), "ios/0.2.0")
        XCTAssertEqual(sent.request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(sent.body, Data(#"{"a":1}"#.utf8))
    }

    func testKeepsTheQueryAndSendsNoBearerWithoutOne() throws {
        Stub.answer = .status(200, "[]")
        _ = try transport().request(
            request: HttpRequest(
                method: .get, path: "/v1/conversations/c1/messages?after=4", body: nil, bearer: nil, client: nil)
        )
        let sent = try XCTUnwrap(Stub.sent)
        XCTAssertEqual(sent.request.httpMethod, "GET")
        XCTAssertEqual(sent.request.url?.query, "after=4")
        XCTAssertNil(sent.request.value(forHTTPHeaderField: "Authorization"))
    }

    func testABuildBelowTheFloorIsAnAnswerAndIsHeard() throws {
        let heard = Heard()
        Stub.answer = .status(426, #"{"error":"client_too_old","minVersion":"0.3.0"}"#)
        let response = try transport(tooOld: heard.add).request(
            request: HttpRequest(method: .get, path: "/v1/me", body: nil, bearer: nil, client: "ios/0.2.0")
        )
        XCTAssertEqual(response.status, 426)
        Stub.answer = .status(426, "not json")
        _ = try transport(tooOld: heard.add).request(
            request: HttpRequest(method: .get, path: "/v1/me", body: nil, bearer: nil, client: "ios/0.2.0")
        )
        XCTAssertEqual(heard.all, ["0.3.0"])
    }

    func testAnErrorStatusIsAnAnswerForTheCore() throws {
        Stub.answer = .status(403, #"{"error":"not_a_member"}"#)
        let response = try transport().request(
            request: HttpRequest(method: .delete, path: "/v1/devices/d2", body: nil, bearer: nil, client: nil)
        )
        XCTAssertEqual(response.status, 403)
        XCTAssertEqual(response.body, #"{"error":"not_a_member"}"#)
    }

    func testAFileGoesUpAsItsBytes() throws {
        Stub.answer = .status(204, "")
        let file = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try Data([0, 1, 2]).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let response = try transport().upload(
            request: HttpRequest(
                method: .put, path: "/v1/conversations/c1/media/m1", body: nil, bearer: "t", client: nil),
            path: file.path(percentEncoded: false)
        )
        XCTAssertEqual(response.status, 204)
        let sent = try XCTUnwrap(Stub.sent)
        XCTAssertEqual(sent.request.httpMethod, "PUT")
        XCTAssertEqual(sent.request.value(forHTTPHeaderField: "Content-Type"), "application/octet-stream")
        XCTAssertEqual(sent.request.value(forHTTPHeaderField: "Authorization"), "Bearer t")
    }

    func testAFileComesDownIntoItsPathAndAnErrorLeavesNone() throws {
        let to = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: to) }
        let request = HttpRequest(
            method: .get, path: "/v1/conversations/c1/media/m1", body: nil, bearer: "t", client: nil)

        Stub.answer = .status(200, "blob")
        XCTAssertEqual(try transport().download(request: request, to: to.path(percentEncoded: false)).status, 200)
        XCTAssertEqual(try Data(contentsOf: to), Data("blob".utf8))

        try FileManager.default.removeItem(at: to)
        Stub.answer = .status(404, #"{"error":"not_found"}"#)
        let missing = try transport().download(request: request, to: to.path(percentEncoded: false))
        XCTAssertEqual(missing.status, 404)
        XCTAssertEqual(missing.body, #"{"error":"not_found"}"#)
        XCTAssertFalse(FileManager.default.fileExists(atPath: to.path(percentEncoded: false)))
    }

    func testNoAnswerIsUnreachableAndNamesNoURL() {
        Stub.answer = .failure(URLError(.timedOut))
        XCTAssertThrowsError(
            try transport().request(
                request: HttpRequest(
                    method: .get, path: "/v1/invites/secret-token", body: nil, bearer: nil, client: nil)
            )
        ) { error in
            guard case TransportError.Unreachable(let detail) = error else {
                return XCTFail("expected Unreachable, got \(error)")
            }
            XCTAssertEqual(detail, "URLError \(URLError.Code.timedOut.rawValue)")
            XCTAssertFalse(detail.contains("secret-token"))
        }
    }
}

/// Answers every request in the test's session, and keeps the last one.
private final class Stub: URLProtocol {
    enum Answer {
        case status(Int, String)
        case failure(URLError)
    }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var _answer = Answer.status(200, "")
    nonisolated(unsafe) private static var _sent: (request: URLRequest, body: Data?)?

    static var answer: Answer {
        get { lock.withLock { _answer } }
        set { lock.withLock { _answer = newValue } }
    }

    static var sent: (request: URLRequest, body: Data?)? { lock.withLock { _sent } }

    static func reset() {
        lock.withLock {
            _answer = .status(200, "")
            _sent = nil
        }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        // URLSession hands a protocol the body as a stream, not as httpBody.
        let body = request.httpBody ?? request.httpBodyStream.map(Self.read)
        Self.lock.withLock { Self._sent = (request, body) }
        switch Self.answer {
        case .status(let status, let text):
            let response = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(text.utf8))
            client?.urlProtocolDidFinishLoading(self)
        case .failure(let error):
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    private static func read(_ stream: InputStream) -> Data {
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1024)
        stream.open()
        defer { stream.close() }
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

/// The minimum versions a transport reported, from whichever thread.
private final class Heard: @unchecked Sendable {
    private let lock = NSLock()
    private var versions: [String] = []

    var all: [String] { lock.withLock { versions } }

    func add(_ version: String) {
        lock.withLock { versions.append(version) }
    }
}
