import Foundation
import SpjallCore

/// The delivery service in memory, as far as two clients exchanging one
/// message need it: sign-in, KeyPackages, conversations with a roster,
/// messages by seq, Welcomes, and a notify frame to every member's device.
/// Signing in hands a link's device the token `token-<device>`, and every
/// other route answers 401 without it. A commit's claim (decision 0020) is
/// found as the JSON text it is in the message's clear authenticated_data,
/// and moves the roster and names the Welcome's recipients. Media blobs
/// (decision 0023) are kept by path for the roster, and a device's push
/// token (0025) by device. It serves a conversation's devices (0028), keeps
/// the build each request named, and refuses one below its floor (0030). The
/// real rules live in the Worker and in the core's own relay.
final class Relay: @unchecked Sendable {
    /// Where Kenni's callback goes, from the frozen URL scheme.
    static let redirect = "is.samtak.spjall:/kenni"

    /// What the browser and Kenni do with an authorize URL: the person
    /// signs in, and the app is handed the callback with a code and the
    /// same `state`.
    static func kenni(_ authorize: String) -> String {
        let state =
            URLComponents(string: authorize)?.queryItems?.first { $0.name == "state" }?.value ?? ""
        return "\(redirect)?code=code-\(state)&state=\(state)"
    }

    private struct Stored {
        let seq: Int
        let sender: String
        let clientMsgId: String
        let ciphertext: String
    }

    private struct Welcome {
        let seq: Int
        let message: String
        let to: [String]
    }

    private struct Conversation {
        var roster: Set<String>
        var messages: [Stored] = []
        var welcomes: [Welcome] = []
    }

    private let lock = NSLock()
    private var devices: [String: String] = [:]
    private var packages: [String: [String]] = [:]
    private var conversations: [String: Conversation] = [:]
    private var waiting: [String: [String]] = [:]
    private var media: [String: Data] = [:]
    private var push: [String: (token: String, sandbox: Bool)] = [:]
    private var clients: [String?] = []
    private var floor: String?

    final class Link: Transport, @unchecked Sendable {
        let relay: Relay
        let account: String
        let device: String

        init(relay: Relay, account: String, device: String) {
            self.relay = relay
            self.account = account
            self.device = device
        }

        func request(request: HttpRequest) throws -> HttpResponse {
            relay.lock.withLock { relay.handle(account: account, device: device, request: request) }
        }

        func upload(request: HttpRequest, path: String) throws -> HttpResponse {
            guard let blob = try? Data(contentsOf: URL(filePath: path)) else {
                throw TransportError.Unreachable(detail: "no file")
            }
            return relay.lock.withLock { relay.put(account: account, device: device, request: request, blob: blob) }
        }

        func download(request: HttpRequest, to: String) throws -> HttpResponse {
            try relay.lock.withLock { try relay.get(account: account, device: device, request: request, to: to) }
        }
    }

    func link(account: String, device: String) -> Link {
        lock.withLock { devices[device] = account }
        return Link(relay: self, account: account, device: device)
    }

    /// The push token a device last set, and whether it is a sandbox one.
    func pushToken(device: String) -> (token: String, sandbox: Bool)? {
        lock.withLock { push[device] }
    }

    /// The `Spjall-Client` each request named, in order.
    func clientHeaders() -> [String?] {
        lock.withLock { clients }
    }

    /// The lowest version served, as `x.y.z`; nil serves every build.
    func setFloor(_ min: String?) {
        lock.withLock { floor = min }
    }

    /// The frames waiting on a device's socket, oldest first.
    func frames(device: String) -> [String] {
        lock.withLock { waiting.removeValue(forKey: device) ?? [] }
    }

    private func handle(account: String, device: String, request: HttpRequest) -> HttpResponse {
        let body =
            request.body.flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] } ?? [:]
        let pieces = request.path.split(separator: "?", maxSplits: 1).map(String.init)
        let after = pieces.count > 1 ? Int(pieces[1].replacingOccurrences(of: "after=", with: "")) ?? 0 : 0
        let parts = pieces[0].dropFirst("/v1/".count).split(separator: "/").map(String.init)
        let token = "token-\(device)"
        clients.append(request.client)
        if let floor {
            let version = request.client?.split(separator: "/").last.map(String.init) ?? "0.1.0"
            if version.compare(floor, options: .numeric) == .orderedAscending {
                return HttpResponse(status: 426, body: json(["error": "client_too_old", "minVersion": floor]))
            }
        }
        switch (request.method, parts) {
        case (.get, ["sign-in"]):
            return ok([
                "authorizationEndpoint": "https://kenni.test/oidc/auth",
                "clientId": "spjall",
                "redirectUri": Relay.redirect,
                "scope": "openid national_id audkenni_name",
            ])
        case (.post, ["devices"]):
            guard body["kenniCode"] as? String ?? "" != "", body["codeVerifier"] as? String ?? "" != "" else {
                return refuse(400, "bad_request")
            }
            return ok(["accountId": account, "deviceId": device, "token": token])
        default:
            guard request.bearer == token else { return refuse(401, "unauthorized") }
        }
        switch (request.method, parts.count, parts.first) {
        case (.post, 1, "key-packages"):
            packages[device, default: []] += body["keyPackages"] as? [String] ?? []
            return ok(["available": packages[device]?.count ?? 0])
        case (.post, 3, "accounts"):
            var claimed: [[String: Any]] = []
            for (other, owner) in devices where owner == parts[1] && other != device {
                if var queue = packages[other], !queue.isEmpty {
                    claimed.append(["deviceId": other, "keyPackage": queue.removeFirst()])
                    packages[other] = queue
                }
            }
            return ok(["keyPackages": claimed])
        case (.put, 3, "devices") where parts[2] == "push":
            guard parts[1] == device else { return refuse(403, "not_this_device") }
            push[device] = (body["token"] as? String ?? "", body["sandbox"] as? Bool ?? false)
            return HttpResponse(status: 204, body: "")
        case (.post, 1, "conversations"):
            let id = body["conversationId"] as? String ?? ""
            if conversations[id] == nil { conversations[id] = Conversation(roster: [account]) }
            return ok(["conversationId": id])
        case (_, 3, "conversations"):
            guard let conversation = conversations[parts[1]] else { return refuse(404, "not_found") }
            guard conversation.roster.contains(account) else { return refuse(403, "not_a_member") }
            switch (request.method, parts[2]) {
            case (.post, "messages"):
                return send(account: account, id: parts[1], body: body)
            case (.get, "messages"):
                let messages = conversation.messages.filter { $0.seq > after }
                    .map { ["seq": $0.seq, "ciphertext": $0.ciphertext] as [String: Any] }
                return ok(["messages": messages, "more": false])
            case (.get, "devices"):
                let accounts = conversation.roster.sorted().map { owner in
                    let ids = devices.filter { $0.value == owner }.keys.sorted()
                    return ["accountId": owner, "deviceIds": ids] as [String: Any]
                }
                return ok(["accounts": accounts])
            case (.get, "welcome"):
                guard let welcome = conversation.welcomes.last(where: { $0.to.contains(account) }) else {
                    return refuse(404, "not_found")
                }
                return ok(["seq": welcome.seq, "welcome": welcome.message])
            default:
                return refuse(404, "not_found")
            }
        default:
            return refuse(404, "not_found")
        }
    }

    /// What a media request is refused with, or nil when its device may make it.
    private func refusal(account: String, device: String, request: HttpRequest) -> HttpResponse? {
        guard request.bearer == "token-\(device)" else { return refuse(401, "unauthorized") }
        let parts = request.path.dropFirst("/v1/".count).split(separator: "/").map(String.init)
        guard parts.count == 4, parts[0] == "conversations", parts[2] == "media",
            let conversation = conversations[parts[1]]
        else { return refuse(404, "not_found") }
        return conversation.roster.contains(account) ? nil : refuse(403, "not_a_member")
    }

    private func put(account: String, device: String, request: HttpRequest, blob: Data) -> HttpResponse {
        if let refused = refusal(account: account, device: device, request: request) { return refused }
        guard media[request.path] == nil else { return refuse(409, "conflict") }
        media[request.path] = blob
        return HttpResponse(status: 204, body: "")
    }

    private func get(account: String, device: String, request: HttpRequest, to: String) throws -> HttpResponse {
        if let refused = refusal(account: account, device: device, request: request) { return refused }
        guard let blob = media[request.path] else { return refuse(404, "not_found") }
        do {
            try blob.write(to: URL(filePath: to))
        } catch {
            throw TransportError.Unreachable(detail: "cannot write")
        }
        return HttpResponse(status: 200, body: "")
    }

    private func send(account: String, id: String, body: [String: Any]) -> HttpResponse {
        guard var conversation = conversations[id] else { return refuse(404, "not_found") }
        let clientMsgId = body["clientMsgId"] as? String ?? ""
        if let known = conversation.messages.first(where: { $0.sender == account && $0.clientMsgId == clientMsgId }) {
            return ok(["seq": known.seq])
        }
        let seq = (conversation.messages.last?.seq ?? 0) + 1
        let ciphertext = body["ciphertext"] as? String ?? ""
        conversation.messages.append(
            Stored(seq: seq, sender: account, clientMsgId: clientMsgId, ciphertext: ciphertext))
        let before = conversation.roster
        if let claim = claim(ciphertext) {
            conversation.roster = Set(claim["roster"] as? [String] ?? [])
            if let welcome = body["welcome"] as? [String: Any] {
                let message = welcome["message"] as? String ?? ""
                conversation.welcomes.append(
                    Welcome(seq: seq, message: message, to: claim["welcome"] as? [String] ?? []))
            }
        }
        conversations[id] = conversation
        let frame = json(["type": "notify", "conversationId": id, "seq": seq])
        for (device, owner) in devices where before.contains(owner) || conversation.roster.contains(owner) {
            waiting[device, default: []].append(frame)
        }
        return ok(["seq": seq])
    }

    /// A commit's claim, or nil for a message that carries none.
    private func claim(_ ciphertext: String) -> [String: Any]? {
        guard let bytes = Data(base64Encoded: ciphertext),
            let start = bytes.firstRange(of: Data(#"{"roster":"#.utf8)),
            let end = bytes[start.lowerBound...].firstIndex(of: UInt8(ascii: "}"))
        else { return nil }
        return (try? JSONSerialization.jsonObject(with: bytes[start.lowerBound...end])) as? [String: Any]
    }

    private func json(_ value: [String: Any]) -> String {
        String(decoding: (try? JSONSerialization.data(withJSONObject: value)) ?? Data(), as: UTF8.self)
    }

    private func ok(_ body: [String: Any]) -> HttpResponse {
        HttpResponse(status: 200, body: json(body))
    }

    private func refuse(_ status: UInt16, _ code: String) -> HttpResponse {
        HttpResponse(status: status, body: json(["error": code]))
    }
}
