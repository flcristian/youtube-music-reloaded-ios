import SwiftUI

/// Answers the open iOS questions on a real device: can we control volume
/// (needed for crossfades), how does YouTube Music stream, and does
/// playback survive the lock screen.
struct DiagnosticsView: View {
    let player: Player
    @State private var checks = ""
    @State private var webAudio = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("""
                    1. Sign in and play a song.
                    2. Lock the phone. Does the music keep playing? \
                    Do lock-screen controls work?
                    3. Run the checks below.
                    4. Run the volume test and listen: the music should get \
                    quieter for a few seconds.
                    5. Lock the phone again: does it still play?
                    """)
                    .font(.callout)
                } header: {
                    Text("Background playback test")
                }

                Section("Page checks") {
                    Button("Run checks") {
                        Task { checks = await player.evaluate("window.__ytmr.diagnose()") }
                    }
                    if !checks.isEmpty {
                        Text(checks)
                            .font(.system(.footnote, design: .monospaced))
                            .textSelection(.enabled)
                    }
                }

                Section("Volume control (Web Audio)") {
                    Button("Run volume test") {
                        Task { webAudio = await player.evaluate("window.__ytmr.testWebAudio()") }
                    }
                    if !webAudio.isEmpty {
                        Text(webAudio)
                            .font(.footnote)
                            .textSelection(.enabled)
                    }
                }
            }
            .navigationTitle("Diagnostics")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}
