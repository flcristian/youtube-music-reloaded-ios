import SwiftUI

@main
struct YouTubeMusicReloadedApp: App {
    @StateObject private var bridge = PlayerBridge()
    @StateObject private var ui = AppUI()
    @State private var nowPlaying: NowPlaying?

    init() {
        AudioSession.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(bridge)
                .environmentObject(ui)
                .environmentObject(bridge.waveforms)
                .preferredColorScheme(.dark)
                .tint(Theme.primaryText)
                .onAppear {
                    if nowPlaying == nil { nowPlaying = NowPlaying(bridge: bridge) }
                }
        }
    }
}
