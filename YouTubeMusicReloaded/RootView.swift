import SwiftUI

/// The native app on top of the hidden YouTube Music page. The page is only
/// shown while signing in.
struct RootView: View {
    @EnvironmentObject private var bridge: PlayerBridge
    /// Show the page anyway if it never reports in (e.g. a consent page).
    @State private var waitedTooLong = false

    private var needsSignIn: Bool {
        if !bridge.onMusicPage { return waitedTooLong || bridge.state.ready }
        return bridge.state.ready && !bridge.state.loggedIn
    }

    private var loading: Bool { !bridge.state.ready && !waitedTooLong }

    var body: some View {
        ZStack {
            WebView(webView: bridge.webView)
                .ignoresSafeArea(edges: .bottom)

            if needsSignIn {
                VStack {
                    Spacer()
                    Text("Sign in to YouTube Music to continue")
                        .font(.footnote.weight(.semibold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Theme.surface, in: Capsule())
                        .padding(.bottom, 8)
                }
                .allowsHitTesting(false)
            } else if loading {
                Theme.background.ignoresSafeArea()
                ProgressView()
            } else {
                MainView()
            }
        }
        .background(Theme.background)
        .task {
            try? await Task.sleep(for: .seconds(10))
            waitedTooLong = true
        }
    }
}
