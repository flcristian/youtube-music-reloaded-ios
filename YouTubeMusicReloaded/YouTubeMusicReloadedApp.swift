import SwiftUI

@main
struct YouTubeMusicReloadedApp: App {
    @StateObject private var bridge = PlayerBridge()
    @State private var nowPlaying: NowPlaying?

    init() {
        AudioSession.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(bridge)
                .preferredColorScheme(.dark)
                .tint(Theme.primaryText)
                .onAppear {
                    if nowPlaying == nil { nowPlaying = NowPlaying(bridge: bridge) }
                }
        }
    }
}
