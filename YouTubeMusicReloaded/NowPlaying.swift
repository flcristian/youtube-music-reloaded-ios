import Combine
import MediaPlayer
import UIKit

/// Lock screen, Control Center and headphone controls for the hidden player.
@MainActor
final class NowPlaying {
    private let bridge: PlayerBridge
    private var subscription: AnyCancellable?
    private var artwork: (url: String, image: MPMediaItemArtwork)?
    private var loadingArtwork: String?

    init(bridge: PlayerBridge) {
        self.bridge = bridge
        registerCommands()
        subscription = bridge.$state
            .removeDuplicates()
            .sink { [weak self] state in self?.update(state) }
    }

    private func registerCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            self?.bridge.resume()
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            self?.bridge.pause()
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.bridge.togglePlayPause()
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            self?.bridge.next()
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            self?.bridge.previous()
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            self?.bridge.seek(to: event.positionTime)
            return .success
        }
    }

    private func update(_ state: PlayerState) {
        let center = MPNowPlayingInfoCenter.default()
        guard state.videoId != nil else {
            center.nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: state.title ?? "",
            MPMediaItemPropertyArtist: state.artist ?? "",
            MPMediaItemPropertyPlaybackDuration: state.duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: state.position,
            MPNowPlayingInfoPropertyPlaybackRate: state.paused ? 0.0 : 1.0,
        ]
        if let cover = state.cover, artwork?.url == cover {
            info[MPMediaItemPropertyArtwork] = artwork?.image
        } else if let cover = state.cover {
            loadArtwork(cover)
        }
        center.nowPlayingInfo = info
        center.playbackState = state.paused ? .paused : .playing
    }

    private func loadArtwork(_ url: String) {
        guard loadingArtwork != url, let address = URL(string: url) else { return }
        loadingArtwork = url
        Task {
            defer { loadingArtwork = nil }
            guard
                let (data, _) = try? await URLSession.shared.data(from: address),
                let image = UIImage(data: data)
            else { return }
            artwork = (url, MPMediaItemArtwork(boundsSize: image.size) { _ in image })
            update(bridge.state)
        }
    }
}
