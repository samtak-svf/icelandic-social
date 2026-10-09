import AuthenticationServices
import SpjallCore
import SwiftUI

@main
struct SpjallApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var signIn = SignInModel(account: SpjallApp.account)

    init() {
        Typefaces.register()
    }

    var body: some Scene {
        WindowGroup {
            RootView(signIn: signIn, push: delegate.push)
                .font(.sans(16))
                .tint(BrandTokens.Colors.primary)
        }
    }

    /// The core, which the screens and the push delegate share; opened on first use.
    nonisolated static let account = CoreAccount(open: CoreStore.open)
}

/// Sign-in until the device is signed in, then "Ég". Invite links arrive
/// through `onOpenURL`; the providers' redirects come back to the browser session.
struct RootView: View {
    let signIn: SignInModel
    let push: PushModel
    var update = Update.shared

    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @Environment(\.openURL) private var openURL

    var body: some View {
        Group {
            // Below the server's floor nothing else would work (decision 0030).
            if update.min != nil {
                UpdateView(onUpdate: { openURL(Self.store) })
            } else {
                screens
            }
        }
        .task { await signIn.check() }
        .onOpenURL { url in
            guard let token = inviteToken(link: url.absoluteString) else { return }
            Task { await signIn.openInvite(token: token) }
        }
    }

    @ViewBuilder private var screens: some View {
        Group {
            switch signIn.session {
            case .checking:
                ProgressView()
            case .signedOut:
                SignInView(
                    model: signIn,
                    onSignIn: { provider in Task { await signIn.signIn(provider: provider, browser: browser) } },
                    onRetry: { Task { await signIn.retry(browser: browser) } }
                )
            case .signedIn:
                // Signed in means the core opened, so the build names its API host.
                if let base = CoreStore.apiBase {
                    HomeView(
                        signIn: signIn,
                        push: push,
                        wire: URLSessionWire(baseURL: base, client: CoreStore.client),
                        browser: browser,
                        onSignedOut: signIn.signedOut
                    )
                    // A fresh socket, list and "Ég" for each sign-in.
                    .id(signIn.signIns)
                }
            }
        }
    }

    /// Where a newer build is: the builds reach testers through TestFlight
    /// until the app is in the App Store.
    private static let store = URL(string: "itms-beta://")!

    /// The provider in a browser sheet that shares no cookies with Safari; nil
    /// when the person closed it.
    private func browser(_ url: URL) async throws -> URL? {
        do {
            return try await webAuthenticationSession.authenticate(
                using: url,
                callbackURLScheme: Self.scheme,
                preferredBrowserSession: .ephemeral
            )
        } catch ASWebAuthenticationSessionError.canceledLogin {
            return nil
        }
    }

    /// The scheme the providers' redirects come back to (identifiers/ids.json `urlScheme`).
    private static let scheme = Bundle.main.object(forInfoDictionaryKey: "SpjallURLScheme") as? String ?? ""
}
