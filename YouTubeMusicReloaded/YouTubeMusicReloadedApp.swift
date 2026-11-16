import SwiftUI

@main
struct YouTubeMusicReloadedApp: App {
    init() {
        AudioSession.configure()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
