import UIKit
import AVFoundation
import WebKit

/// The YouTube Music page, running hidden behind the native screens. It does
/// the actual playback (and sign-in); `Scripts/bridge.js` lets us control it.
@MainActor
final class PlayerBridge: NSObject, ObservableObject {
    static let home = URL(string: "https://music.youtube.com/")!

    /// Desktop Safari: Google refuses to sign in from "embedded" browser
    /// agents, and the bridge expects YouTube Music's desktop page.
    static let userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
        + "(KHTML, like Gecko) Version/18.0 Safari/605.1.15"

    /// Injected at document start, in this order (files in `Scripts/`).
    static let scripts = ["keep-visible", "bridge"]

    let webView: WKWebView

    /// Latest player state, and when it was reported (to move the position
    /// along between reports).
    @Published private(set) var state = PlayerState()
    @Published private(set) var stateAt = Date()
    /// Whether the YouTube Music page itself is loaded (not sign-in pages).
    @Published private(set) var onMusicPage = false
    /// Plays both songs of a crossfade natively.
    private(set) lazy var crossfade: CrossfadeEngine = {
        let engine = CrossfadeEngine(bridge: self)
        engine.curve = {
            FadeCurve(
                rawValue: UserDefaults.standard.string(forKey: SettingsKey.crossfadeCurve)
                    ?? "") ?? .equalPower
        }
        return engine
    }()

    /// Send the crossfade settings to the page.
    func applyCrossfadeSettings() {
        let defaults = UserDefaults.standard
        let number = { (key: String, fallback: Double) in
            defaults.object(forKey: key) as? Double ?? fallback
        }
        send(
            "crossfadeConfig",
            [
                // Not in the background: there the player can't get its
                // sound back after being muted (it plays on, silent).
                "enabled": defaults.bool(forKey: SettingsKey.crossfadeEnabled)
                    && UIApplication.shared.applicationState != .background,
                "autoEnabled": defaults.object(forKey: SettingsKey.crossfadeAuto) as? Bool ?? true,
                "autoDuration": number(SettingsKey.crossfadeAutoDuration, 5),
                "manualEnabled": defaults.object(forKey: SettingsKey.crossfadeManual) as? Bool
                    ?? true,
                "manualDuration": number(SettingsKey.crossfadeManualDuration, 5),
            ])
    }

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
        webView.isOpaque = false
        #if DEBUG
        // Safari > Develop > (your iPhone) can inspect the page.
        webView.isInspectable = true
        #endif
        super.init()
        configuration.userContentController.add(
            WeakMessageHandler(self), name: "ytmrState")
        configuration.userContentController.add(
            WeakMessageHandler(self), name: "ytmrFade")
        // Set up the crossfade's audio now, before anything plays: creating
        // it sets up the audio output, which makes the player drop out for
        // a moment if it's playing (the first skip used to pause).
        _ = crossfade
        for name in [
            UIApplication.didEnterBackgroundNotification,
            UIApplication.willEnterForegroundNotification,
        ] {
            NotificationCenter.default.addObserver(
                forName: name, object: nil, queue: .main
            ) { [weak self] _ in
                Task { @MainActor in self?.applyCrossfadeSettings() }
            }
        }
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.load(URLRequest(url: Self.home))
    }

    /// The position right now, counting time since the last report.
    func position(at date: Date = Date()) -> Double {
        guard !state.paused else { return state.position }
        let moved = state.position + date.timeIntervalSince(stateAt)
        return state.duration > 0 ? min(moved, state.duration) : moved
    }

    // MARK: Commands

    struct BridgeError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private struct Envelope<T: Decodable>: Decodable {
        let result: T?
        let error: String?
    }

    /// Calls a method of `window.__ytmr` in the page.
    func call<T: Decodable>(
        _ method: String, _ params: [String: Any] = [:], as type: T.Type
    ) async throws -> T {
        let raw = try await webView.callAsyncJavaScript(
            """
            if (!window.__ytmr) return JSON.stringify({ error: 'YouTube Music is still loading' });
            return await window.__ytmr.call(method, params);
            """,
            arguments: ["method": method, "params": params],
            contentWorld: .page
        )
        guard let text = raw as? String, let data = text.data(using: .utf8) else {
            throw BridgeError(message: "No answer from YouTube Music")
        }
        let envelope = try JSONDecoder().decode(Envelope<T>.self, from: data)
        if let error = envelope.error { throw BridgeError(message: error) }
        guard let result = envelope.result else {
            throw BridgeError(message: "Empty answer from YouTube Music")
        }
        return result
    }

    /// Fire-and-forget command; failures are only logged.
    func send(_ method: String, _ params: [String: Any] = [:]) {
        Task {
            do {
                _ = try await call(method, params, as: Bool.self)
            } catch {
                print("[PlayerBridge] \(method): \(error.localizedDescription)")
            }
        }
    }

    func play(_ videoId: String) { send("play", ["videoId": videoId]) }
    func playQueueItem(_ index: Int) { send("playQueueItem", ["index": index]) }
    func enqueue(_ videoId: String, _ position: QueuePosition, part: Part? = nil) {
        send("enqueue", ["videoId": videoId, "position": position.rawValue] + Self.params(part))
    }
    /// Play part of a song now.
    func play(_ videoId: String, part: Part) {
        send("playPart", ["videoId": videoId] + Self.params(part))
    }
    func songInfo(_ videoId: String, bestPartLength: Double) async throws -> SongInfo {
        try await call(
            "songInfo", ["videoId": videoId, "part": bestPartLength], as: SongInfo.self)
    }
    /// "Play best parts" / "Shuffle best parts" of a playlist or album.
    func playBestParts(_ playlistId: String, shuffle: Bool, partLength: Double) {
        send("bestParts", ["playlistId": playlistId, "shuffle": shuffle, "part": partLength])
    }

    private static func params(_ part: Part?) -> [String: Any] {
        guard let part else { return [:] }
        var params: [String: Any] = ["start": part.start]
        if let end = part.end { params["end"] = end }
        return params
    }
    func next() { send("next") }
    func previous() { send("previous") }
    func pause() { send("pause") }
    func resume() { send("resume") }
    func togglePlayPause() { state.paused ? resume() : pause() }
    func seek(to seconds: Double) {
        state.position = seconds
        stateAt = Date()
        send("seek", ["seconds": seconds])
    }

    func playEndpoint(_ endpoint: String) { send("playEndpoint", ["endpoint": endpoint]) }

    func page(_ endpoint: String) async throws -> Page {
        try await call("page", ["endpoint": endpoint], as: Page.self)
    }
    func search(_ query: String) async throws -> Page {
        try await call("search", ["query": query], as: Page.self)
    }
    func more(_ continuation: String, search: Bool) async throws -> Page {
        try await call("more", ["continuation": continuation, "search": search], as: Page.self)
    }
    func queue() async throws -> [QueueItem] {
        try await call("queue", as: [QueueItem].self)
    }


    // MARK: Page

    fileprivate func receive(_ body: Any) {
        guard
            let text = body as? String,
            let data = text.data(using: .utf8),
            let next = try? JSONDecoder().decode(PlayerState.self, from: data)
        else { return }
        let becameReady = next.ready && !state.ready
        state = next
        stateAt = Date()
        // A (re)loaded page starts without the app's settings.
        if becameReady { applyCrossfadeSettings() }
    }

    private static func userScript(_ name: String) -> WKUserScript? {
        guard
            let url = Bundle.main.url(forResource: name, withExtension: "js"),
            let source = try? String(contentsOf: url, encoding: .utf8)
        else {
            print("[PlayerBridge] missing script \(name).js")
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

extension PlayerBridge: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        onMusicPage = webView.url?.host == Self.home.host
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        onMusicPage = webView.url?.host == Self.home.host
    }
}

extension PlayerBridge: WKUIDelegate {
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

/// Keeps the page's message handler from retaining the bridge.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var bridge: PlayerBridge?

    init(_ bridge: PlayerBridge) { self.bridge = bridge }

    func userContentController(
        _ controller: WKUserContentController, didReceive message: WKScriptMessage
    ) {
        let body = message.body
        let name = message.name
        MainActor.assumeIsolated {
            if name == "ytmrFade" {
                if let text = body as? String { bridge?.crossfade.receive(text) }
            } else {
                bridge?.receive(body)
            }
        }
    }
}

private func + (lhs: [String: Any], rhs: [String: Any]) -> [String: Any] {
    lhs.merging(rhs) { _, new in new }
}
