import WebKit

/// The YouTube Music page and the scripts we inject into it.
@MainActor
final class Player: NSObject, ObservableObject {
    static let home = URL(string: "https://music.youtube.com/")!

    /// Desktop Safari: our features are written for YouTube Music's desktop
    /// site, and Google refuses to sign in from "embedded" browser agents.
    static let userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
        + "(KHTML, like Gecko) Version/18.0 Safari/605.1.15"

    /// Injected at document start, in this order (files in `Scripts/`).
    static let scripts = ["keep-visible", "diagnostics"]

    let webView: WKWebView

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.websiteDataStore = .default()
        for name in Self.scripts {
            if let script = Self.userScript(name) {
                configuration.userContentController.addUserScript(script)
            }
        }

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.customUserAgent = Self.userAgent
        webView.allowsBackForwardNavigationGestures = true
        #if DEBUG
        // Safari > Develop > (your iPhone) can inspect the page.
        webView.isInspectable = true
        #endif
        super.init()
        webView.uiDelegate = self
        webView.load(URLRequest(url: Self.home))
    }

    /// Runs `expression` (may `await`) in the page and returns its result.
    func evaluate(_ expression: String) async -> String {
        do {
            let result = try await webView.callAsyncJavaScript(
                "return await (\(expression));",
                contentWorld: .page
            )
            return result.map { "\($0)" } ?? "(no result)"
        } catch {
            return "Error: \(error.localizedDescription)"
        }
    }

    private static func userScript(_ name: String) -> WKUserScript? {
        guard
            let url = Bundle.main.url(forResource: name, withExtension: "js"),
            let source = try? String(contentsOf: url, encoding: .utf8)
        else {
            print("[Player] missing script \(name).js")
            return nil
        }
        return WKUserScript(
            source: source,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true,
            in: .page
        )
    }
}

extension Player: WKUIDelegate {
    /// Sign-in and other links that open a new window load in this view.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
        }
        return nil
    }
}
