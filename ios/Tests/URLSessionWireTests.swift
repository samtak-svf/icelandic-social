import Foundation
import Network
import XCTest

@testable import Spjall

/// The real `URLSessionWire` against a WebSocket server on the loopback that never answers a ping.
final class URLSessionWireTests: XCTestCase {
    func testOpensOnTheUpgradeAndReadsWithoutAPong() throws {
        let server = try SilentServer(greeting: #"{"type":"hello"}"#)
        defer { server.stop() }
        let heard = Signals()
        let opened = expectation(description: "opened")
        let framed = expectation(description: "frame")
        let wire = URLSessionWire(baseURL: URL(string: "http://127.0.0.1:\(try server.port())/")!)

        let link = wire.open(token: "t") { signal in
            heard.add(signal)
            switch signal {
            case .opened: opened.fulfill()
            case .frame: framed.fulfill()
            case .closed: break
            }
        }
        defer { link.close() }

        wait(for: [opened, framed], timeout: 5)
        XCTAssertTrue(heard.all.contains(.frame(#"{"type":"hello"}"#)))
        XCTAssertFalse(heard.all.contains(.closed))
    }
}

private final class Signals: @unchecked Sendable {
    private let lock = NSLock()
    private var signals: [Signal] = []

    func add(_ signal: Signal) { lock.withLock { signals.append(signal) } }
    var all: [Signal] { lock.withLock { signals } }
}

/// Accepts WebSocket upgrades, sends each one `greeting`, and lets pings go unanswered.
private final class SilentServer: @unchecked Sendable {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "silent-server")
    private var connections: [NWConnection] = []

    init(greeting: String) throws {
        let socket = NWProtocolWebSocket.Options()
        socket.autoReplyPing = false
        let parameters = NWParameters.tcp
        parameters.defaultProtocolStack.applicationProtocols.insert(socket, at: 0)
        listener = try NWListener(using: parameters, on: .any)
        listener.newConnectionHandler = { [self] connection in
            connections.append(connection)
            connection.start(queue: queue)
            let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
            let context = NWConnection.ContentContext(identifier: "greeting", metadata: [metadata])
            connection.send(
                content: Data(greeting.utf8), contentContext: context, isComplete: true, completion: .idempotent)
        }
        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { state in
            if case .ready = state { ready.signal() }
        }
        listener.start(queue: queue)
        _ = ready.wait(timeout: .now() + 5)
    }

    func port() throws -> UInt16 { try XCTUnwrap(listener.port?.rawValue) }

    func stop() {
        queue.sync { connections.forEach { $0.cancel() } }
        listener.cancel()
    }
}
