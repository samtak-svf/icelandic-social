import Foundation

/// `Wire` over `URLSessionWebSocketTask`. The socket is open once the upgrade
/// is answered, and reading starts at once: URLSession reads a pong only while
/// a receive waits, so a socket that waited for its first pong before reading
/// never opened. A ping every 20 s then fails the socket when its pong is
/// missed: a network change can end a socket without closing it (decision
/// 0022). Nothing here logs, since the upgrade carries the device token. The
/// upgrade names the build as every core request does (decision 0030).
struct URLSessionWire: Wire {
    private let url: URL
    private let session: URLSession
    private let client: String?

    init(baseURL: URL, session: URLSession = .shared, client: String? = nil) {
        var components = URLComponents(url: baseURL.appending(path: "v1/ws"), resolvingAgainstBaseURL: false)
        components?.scheme = baseURL.scheme == "http" ? "ws" : "wss"
        self.url = components?.url ?? baseURL
        self.session = session
        self.client = client
    }

    func open(token: String, on: @escaping @Sendable (Signal) -> Void) -> Link {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let client { request.setValue(client, forHTTPHeaderField: "Spjall-Client") }
        let link = WebSocketLink(task: session.webSocketTask(with: request), on: on)
        link.start()
        return link
    }
}

private final class WebSocketLink: NSObject, Link, URLSessionWebSocketDelegate, @unchecked Sendable {
    private static let ping: Duration = .seconds(20)

    private let task: URLSessionWebSocketTask
    private let on: @Sendable (Signal) -> Void
    private let lock = NSLock()
    private var closed = false
    private var pinging: Task<Void, Never>?
    private var pings = 0
    private var pongs = 0

    init(task: URLSessionWebSocketTask, on: @escaping @Sendable (Signal) -> Void) {
        self.task = task
        self.on = on
        super.init()
        task.delegate = self
    }

    func start() {
        task.resume()
        receive()
    }

    func urlSession(
        _ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?
    ) {
        on(.opened)
        keepAlive()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        finish()
    }

    func send(_ frame: String) {
        task.send(.string(frame)) { [self] error in
            if error != nil { finish() }
        }
    }

    func close() {
        task.cancel(with: .normalClosure, reason: nil)
        finish()
    }

    private func receive() {
        task.receive { [self] result in
            switch result {
            case .success(.string(let text)):
                on(.frame(text))
                receive()
            case .success:
                // The server sends text frames only.
                receive()
            case .failure:
                finish()
            }
        }
    }

    /// A ping each interval; a pong not back by the next one ends the socket.
    private func keepAlive() {
        let pinging = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.ping)
                guard !Task.isCancelled, let self else { return }
                guard lock.withLock({ pongs == pings }) else {
                    task.cancel(with: .goingAway, reason: nil)
                    return finish()
                }
                lock.withLock { pings += 1 }
                task.sendPing { [self] error in
                    if error == nil { lock.withLock { pongs += 1 } } else { finish() }
                }
            }
        }
        let ended = lock.withLock {
            self.pinging = pinging
            return closed
        }
        if ended { pinging.cancel() }
    }

    /// Says `.closed` once, however many ways the socket ended.
    private func finish() {
        let (first, pinging) = lock.withLock {
            defer { closed = true }
            return (!closed, self.pinging)
        }
        guard first else { return }
        pinging?.cancel()
        on(.closed)
    }
}
