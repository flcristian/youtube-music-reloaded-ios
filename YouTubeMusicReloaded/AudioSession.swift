import AVFoundation

enum AudioSession {
    /// Music playback: keeps playing with the silent switch on, the screen
    /// locked or the app in the background (with the "audio" background mode).
    static func configure() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default)
            try session.setActive(true)
        } catch {
            print("[AudioSession] \(error)")
        }
    }
}
