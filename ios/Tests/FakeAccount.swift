import Foundation
import SpjallCore

@testable import Spjall

/// The core as the models see it, in memory. `failNext` makes the next call
/// throw instead, and `calls` records what was asked, in order.
final class FakeAccount: Account, @unchecked Sendable {
    static let kenni = "https://kenni.test/oidc/auth?state=s1"

    private let lock = NSLock()
    private var _calls: [String] = []
    private var _failNext: Error?
    private var _signedIn: Bool
    private var _link: String?
    private var links = 0
    var inviters: [String: Inviter?] = [:]
    private var devices = [
        AccountDevice(deviceId: "d1", platform: .ios, createdAt: 1_700_000_000_000, current: true),
        AccountDevice(deviceId: "d2", platform: .android, createdAt: 1_700_000_100_000, current: false),
    ]

    init(signedIn: Bool = false) {
        _signedIn = signedIn
    }

    var calls: [String] { lock.withLock { _calls } }

    var failNext: Error? {
        get { lock.withLock { _failNext } }
        set { lock.withLock { _failNext = newValue } }
    }

    var link: String? {
        get { lock.withLock { _link } }
        set { lock.withLock { _link = newValue } }
    }

    private func call(_ name: String) throws {
        try lock.withLock {
            _calls.append(name)
            if let failure = _failNext {
                _failNext = nil
                throw failure
            }
        }
    }

    func signedIn() throws -> Bool {
        try call("signedIn")
        return lock.withLock { _signedIn }
    }

    func beginSignIn() throws -> String {
        try call("beginSignIn")
        return Self.kenni
    }

    func completeSignIn(callback: String, inviteToken: String?) throws {
        try call("completeSignIn \(callback) \(inviteToken ?? "-")")
        lock.withLock { _signedIn = true }
    }

    func stockKeyPackages() throws { try call("stockKeyPackages") }

    func resolveInvite(token: String) throws -> Inviter? {
        try call("resolveInvite \(token)")
        guard let inviter = inviters[token] else { throw CoreError.Refused(status: 404, code: "not_found") }
        return inviter
    }

    func me() throws -> Me {
        try call("me")
        return lock.withLock { Me(accountId: "a1", name: "Jón Jónsson", verified: true, devices: devices) }
    }

    func inviteLink() throws -> String? {
        try call("inviteLink")
        return link
    }

    func rotateInvite() throws -> String {
        try call("rotateInvite")
        return lock.withLock {
            links += 1
            _link = "https://link.test/l/\(links)"
            return _link!
        }
    }

    func revokeDevice(deviceId: String) throws {
        try call("revokeDevice \(deviceId)")
        lock.withLock {
            if devices.first(where: { $0.deviceId == deviceId })?.current == true { _signedIn = false }
            devices.removeAll { $0.deviceId == deviceId }
        }
    }

    func deleteAccount() throws {
        try call("deleteAccount")
        lock.withLock { _signedIn = false }
    }
}

let unreachable = CoreError.Unreachable(detail: "URLError -1001")
