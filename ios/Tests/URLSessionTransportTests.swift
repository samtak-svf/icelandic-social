import Foundation
import SpjallCore
import XCTest

@testable import Spjall

final class URLSessionTransportTests: XCTestCase {
    override func tearDown() {
        Stub.reset()
    }

    private func transport() -> URLSessionTransport {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [Stub.self]
        return URLSessionTransport(
            baseURL: URL(string: "https://api.test/")!, session: URLSession(configuration: configuration))
    }

    func testSendsTheCoresRequestAsItIs() throws {
        Stub.answer = .status(200, #"{"seq":1}"#)
        let token = ["dev", "ice", "-", "tok"].joined()
        let response = try transport().request(
            request: HttpRequest(method: .post, path: "/v1/conversations/c1/messages", body: #"{"a":1}"#, bearer: token)
        )
        XCTAssertEqual(response.status, 200)
        XCTAssertEqual(response.body, #"{"seq":1}"#)

        let sent = try XCTUnwrap(Stub.sent)
        XCTAssertEqual(sent.request.httpMethod, "POST")
        XCTAssertEqual(sent.request.url?.absoluteString, "https://api.test/v1/conversations/c1/messages")
        XCTAssertEqual(sent.request.value(forHTTPHeaderField: "Authorization"), "Bearer \(token)")
        XCTAssertEqual(sent.request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(sent.body, Data(#"{"a":1}"#.utf8))
    }

    func testKeepsTheQueryAndSendsNoBearerWithoutOne() throws {
        Stub.answer = .status(200, "[]")
        _ = try transport().request(
            request: HttpRequest(method: .get, path: "/v1/conversations/c1/messages?after=4", body: nil, bearer: nil)
        )
        let sent = try XCTUnwrap(Stub.sent)
        XCTAssertEqual(sent.request.httpMethod, "GET")
        XCTAssertEqual(sent.request.url?.query, "after=4")
        XCTAssertNil(sent.request.value(forHTTPHeaderField: "Authorization"))
    }

    func testAnErrorStatusIsAnAnswerForTheCore() throws {
        Stub.answer = .status(403, #"{"error":"not_a_member"}"#)
        let response = try transport().request(
            request: HttpRequest(method: .delete, path: "/v1/devices/d2", body: nil, bearer: nil)
        )
        XCTAssertEqual(response.status, 403)
        XCTAssertEqual(response.body, #"{"error":"not_a_member"}"#)
    }

    func testNoAnswerIsUnreachableAndNamesNoURL() {
        Stub.answer = .failure(URLError(.timedOut))
        XCTAssertThrowsError(
            try transport().request(
                request: HttpRequest(method: .get, path: "/v1/invites/secret-token", body: nil, bearer: nil)
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
