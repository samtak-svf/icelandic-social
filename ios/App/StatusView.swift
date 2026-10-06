import Foundation
import SpjallAPI
import SpjallCore
import SwiftUI

/// Phase 0: the brand's name and residency sentence, then whether the Rust
/// core and the API answer. The diagnostics are versions and status tokens,
/// not sentences, so they are not brand strings.
struct StatusView: View {
    @State private var core = "core …"
    @State private var api = "api …"

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("app_name")
                .font(.largeTitle)
                .foregroundStyle(BrandTokens.Colors.primary)
            Text("residency_claim")
                .font(.body)
                .foregroundStyle(BrandTokens.Colors.fg)
            Group {
                Text(verbatim: core)
                Text(verbatim: api)
            }
            .font(.footnote.monospaced())
            .foregroundStyle(BrandTokens.Colors.mutedFg)
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandTokens.Colors.surface)
        .task {
            core = await Task.detached { Diagnostics.coreLine() }.value
            api = await Diagnostics.apiLine()
        }
    }
}

/// One line each; values and type names only, never user data (decision 0008).
enum Diagnostics {
    static func coreLine() -> String {
        do {
            let epoch = try mlsSelfTest()
            let dir = try StoreLocation.directory()
            let key = try StoreKey(accessGroup: StoreLocation.appGroup).load()
            let schema = try CoreStore.open(dir: dir.path(percentEncoded: false), key: key).schemaVersion()
            return "core \(coreVersion()) · envelope v\(envelopeVersion()) · mls epoch \(epoch) · store v\(schema)"
        } catch {
            return "core ✗ \(type(of: error))"
        }
    }

    static func apiLine() async -> String {
        guard let host = Bundle.main.object(forInfoDictionaryKey: "SpjallAPIHost") as? String,
            let url = URL(string: "https://\(host)")
        else {
            return "api ✗ host"
        }
        do {
            let health = try await HealthClient(baseURL: url).fetch()
            return "api \(health.status.rawValue) · min ios \(health.minClientVersion.ios)"
        } catch {
            return "api ✗ \(type(of: error))"
        }
    }
}
