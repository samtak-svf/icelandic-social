import Foundation
import SpjallCore

/// The delivery service in memory, as far as two clients exchanging one
/// message need it: KeyPackages, conversations with a roster, messages by
/// seq, Welcomes, and a notify frame to every member's device. The real
/// rules live in the Worker and in the core's own relay.
final class Relay: @unchecked Sendable {
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
    }

    func link(account: String, device: String) -> Link {
        lock.withLock { devices[device] = account }
        return Link(relay: self, account: account, device: device)
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
        if let roster = body["roster"] as? [String: Any] {
            conversation.roster.formUnion(roster["add"] as? [String] ?? [])
            conversation.roster.subtract(roster["remove"] as? [String] ?? [])
        }
        if let welcome = body["welcome"] as? [String: Any] {
            let message = welcome["message"] as? String ?? ""
            conversation.welcomes.append(Welcome(seq: seq, message: message, to: welcome["to"] as? [String] ?? []))
        }
        conversations[id] = conversation
        let frame = json(["type": "notify", "conversationId": id, "seq": seq])
        for (device, owner) in devices where before.contains(owner) || conversation.roster.contains(owner) {
            waiting[device, default: []].append(frame)
        }
        return ok(["seq": seq])
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
