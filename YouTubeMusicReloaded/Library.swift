import SwiftUI
import UIKit

/// A playlist a song can be added to (see `playlistsFor` in `library.ts`).
struct PlaylistOption: Decodable, Identifiable, Hashable {
    let playlistId: String
    let title: String
    /// The song is in it already.
    let contains: Bool
    var id: String { playlistId }
}

/// A song the actions below are about.
struct SongTarget: Identifiable, Hashable {
    let videoId: String
    let title: String
    var id: String { videoId }
}

extension PlayerBridge {
    func isLiked(_ videoId: String) async throws -> Bool {
        try await call("likeStatus", ["videoId": videoId], as: String.self) == "LIKE"
    }
    func rate(_ videoId: String, like: Bool) async throws {
        _ = try await call("rate", ["videoId": videoId, "like": like], as: Bool.self)
    }
    func playlists(for videoId: String) async throws -> [PlaylistOption] {
        try await call("playlistsFor", ["videoId": videoId], as: [PlaylistOption].self)
    }
    func add(_ videoId: String, to playlistId: String) async throws {
        _ = try await call(
            "addToPlaylist", ["videoId": videoId, "playlistId": playlistId], as: Bool.self)
    }
    func createPlaylist(_ title: String, with videoId: String) async throws {
        _ = try await call(
            "createPlaylist", ["title": title, "videoId": videoId], as: String.self)
    }
    func saveSong(_ videoId: String) async throws {
        _ = try await call("saveToLibrary", ["videoId": videoId], as: Bool.self)
    }
    func savePlaylist(_ playlistId: String) async throws {
        _ = try await call("saveToLibrary", ["playlistId": playlistId], as: Bool.self)
    }
    func radio(videoId: String) { send("radio", ["videoId": videoId]) }
    func radio(playlistId: String) { send("radio", ["playlistId": playlistId]) }
    func enqueuePlaylist(_ playlistId: String, _ position: QueuePosition) {
        send("enqueuePlaylist", ["playlistId": playlistId, "position": position.rawValue])
    }
    /// Best parts of a song's radio.
    func playRadioBestParts(videoId: String, partLength: Double) {
        send("bestParts", ["radio": ["videoId": videoId], "shuffle": false, "part": partLength])
    }
    /// Best parts of a playlist's radio.
    func playRadioBestParts(playlistId: String, partLength: Double) {
        send(
            "bestParts", ["radio": ["playlistId": playlistId], "shuffle": false, "part": partLength])
    }
    /// A playlist or album, shuffled: its page's Shuffle button (or the
    /// shuffled playlist endpoint if the page has none).
    func shufflePlay(playlistId: String, open: String?) async {
        if let open, let page = try? await page(open), let shuffle = page.header?.shuffle {
            playEndpoint(shuffle)
            return
        }
        let endpoint: [String: Any] = [
            "watchPlaylistEndpoint": ["playlistId": playlistId, "params": "wAEB8gECKAE%3D"]
        ]
        if let data = try? JSONSerialization.data(withJSONObject: endpoint),
            let text = String(data: data, encoding: .utf8)
        {
            playEndpoint(text)
        }
    }
    /// A song's best part, now (from the start if it has no data).
    func playBestPart(_ videoId: String, partLength: Double) async {
        let info = try? await songInfo(videoId, bestPartLength: partLength)
        play(videoId, part: info?.best ?? Part(start: 0))
    }
    func moveQueueItem(from: Int, to: Int) { send("moveQueueItem", ["from": from, "to": to]) }
}

extension AppUI {
    /// Run a library action, then say how it went.
    func run(_ done: String, _ work: @escaping () async throws -> Void) {
        Task { @MainActor in
            do {
                try await work()
                show(done)
            } catch {
                show(error.localizedDescription)
            }
        }
    }

    /// A short message above the player bar.
    func show(_ message: String) {
        toast = message
        let shown = message
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            if toast == shown { toast = nil }
        }
    }

    /// Hold on a song: like it.
    func like(_ videoId: String, bridge: PlayerBridge) {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        run("Added to Liked songs") { try await bridge.rate(videoId, like: true) }
    }
}

/// Menu entries for a song: like, library, playlist, radio.
struct SongActions: View {
    @EnvironmentObject private var bridge: PlayerBridge
    @EnvironmentObject private var ui: AppUI
    let song: SongTarget

    var body: some View {
        Button { ui.like(song.videoId, bridge: bridge) } label: {
            Label("Like", systemImage: "hand.thumbsup")
        }
        Button {
            ui.run("Saved to library") { try await bridge.saveSong(song.videoId) }
        } label: {
            Label("Save to library", systemImage: "plus.square.on.square")
        }
        Button { ui.addToPlaylist = song } label: {
            Label("Add to playlist…", systemImage: "text.badge.plus")
        }
    }
}

/// Play radio / Play radio best parts, for a song or a playlist.
struct RadioActions: View {
    @EnvironmentObject private var bridge: PlayerBridge
    @AppStorage(SettingsKey.bestPartLength) private var bestPartLength =
        SettingsDefault.bestPartLength
    var videoId: String?
    var playlistId: String?

    var body: some View {
        Button {
            if let videoId { bridge.radio(videoId: videoId) }
            else if let playlistId { bridge.radio(playlistId: playlistId) }
        } label: {
            Label("Play radio", systemImage: "dot.radiowaves.left.and.right")
        }
        Button {
            if let videoId {
                bridge.playRadioBestParts(videoId: videoId, partLength: bestPartLength)
            } else if let playlistId {
                bridge.playRadioBestParts(playlistId: playlistId, partLength: bestPartLength)
            }
        } label: {
            Label("Play radio best parts", systemImage: "sparkles")
        }
    }
}

/// The menu of a song, album or playlist (⋮ and holding a card):
/// Play next, Shuffle play, best parts, radio, then the rest.
struct ItemActions: View {
    @EnvironmentObject private var bridge: PlayerBridge
    @EnvironmentObject private var ui: AppUI
    @AppStorage(SettingsKey.bestPartLength) private var bestPartLength =
        SettingsDefault.bestPartLength
    let item: Item
    let open: (String) -> Void

    var body: some View {
        if let videoId = item.videoId {
            Button { bridge.enqueue(videoId, .next) } label: {
                Label("Play next", systemImage: "text.line.first.and.arrowtriangle.forward")
            }
            Button {
                Task { await bridge.playBestPart(videoId, partLength: bestPartLength) }
            } label: {
                Label("Play best part", systemImage: "sparkles")
            }
            RadioActions(videoId: videoId)
            Button { bridge.enqueue(videoId, .end) } label: {
                Label("Add to queue", systemImage: "text.badge.plus")
            }
            if let target = item.playFromTarget {
                Button { ui.playFrom = target } label: {
                    Label("Play from…", systemImage: "play.square")
                }
            }
            if let song = item.song { SongActions(song: song) }
        } else if let playlistId = item.playlistId {
            Button { bridge.enqueuePlaylist(playlistId, .next) } label: {
                Label("Play next", systemImage: "text.line.first.and.arrowtriangle.forward")
            }
            Button {
                Task { await bridge.shufflePlay(playlistId: playlistId, open: item.open) }
            } label: {
                Label("Shuffle play", systemImage: "shuffle")
            }
            Button {
                bridge.playBestParts(playlistId, shuffle: false, partLength: bestPartLength)
            } label: {
                Label("Play best parts", systemImage: "sparkles")
            }
            Button {
                bridge.playBestParts(playlistId, shuffle: true, partLength: bestPartLength)
            } label: {
                Label("Shuffle best parts", systemImage: "shuffle")
            }
            RadioActions(playlistId: playlistId)
            Button { bridge.enqueuePlaylist(playlistId, .end) } label: {
                Label("Add to queue", systemImage: "text.badge.plus")
            }
            Button {
                ui.run("Saved to library") { try await bridge.savePlaylist(playlistId) }
            } label: {
                Label("Save to library", systemImage: "plus.square.on.square")
            }
        }
        if !item.playsOnTap, let endpoint = item.open {
            Button { open(endpoint) } label: {
                Label("Open", systemImage: "arrow.right")
            }
        }
    }
}

/// Menu entries for a playlist or album: library, radio.
struct PlaylistActions: View {
    @EnvironmentObject private var bridge: PlayerBridge
    @EnvironmentObject private var ui: AppUI
    let playlistId: String

    var body: some View {
        Button {
            ui.run("Saved to library") { try await bridge.savePlaylist(playlistId) }
        } label: {
            Label("Save to library", systemImage: "plus.square.on.square")
        }
        RadioActions(playlistId: playlistId)
    }
}

/// "Add to playlist": the user's playlists, or a new one.
struct AddToPlaylistView: View {
    @EnvironmentObject private var bridge: PlayerBridge
    @EnvironmentObject private var ui: AppUI
    @Environment(\.dismiss) private var dismiss
    let song: SongTarget

    @State private var playlists: [PlaylistOption]?
    @State private var error: String?
    @State private var newTitle = ""
    @State private var naming = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button { naming = true } label: {
                        Label("New playlist", systemImage: "plus")
                    }
                }
                Section {
                    if let playlists {
                        ForEach(playlists) { playlist in
                            Button { add(to: playlist) } label: {
                                HStack {
                                    Text(playlist.title)
                                        .foregroundStyle(Theme.primaryText)
                                    Spacer()
                                    if playlist.contains {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(Theme.secondaryText)
                                    }
                                }
                            }
                            .disabled(playlist.contains)
                        }
                    } else {
                        Text(error ?? "Loading…")
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
            }
            .navigationTitle("Add to playlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .alert("New playlist", isPresented: $naming) {
                TextField("Title", text: $newTitle)
                Button("Cancel", role: .cancel) {}
                Button("Create") { create() }
            }
        }
        .preferredColorScheme(.dark)
        .task {
            do {
                playlists = try await bridge.playlists(for: song.videoId)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func add(to playlist: PlaylistOption) {
        let videoId = song.videoId
        ui.run("Added to \(playlist.title)") { try await bridge.add(videoId, to: playlist.playlistId) }
        dismiss()
    }

    private func create() {
        let title = newTitle.trimmingCharacters(in: .whitespaces)
        guard !title.isEmpty else { return }
        let videoId = song.videoId
        ui.run("Added to \(title)") { try await bridge.createPlaylist(title, with: videoId) }
        dismiss()
    }
}

/// A short message (like "Added to Liked songs") above the player bar.
struct MessageToast: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 14))
            .foregroundStyle(Theme.primaryText)
            .lineLimit(1)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface)
            .overlay(alignment: .top) { Theme.divider.frame(height: 1) }
    }
}
