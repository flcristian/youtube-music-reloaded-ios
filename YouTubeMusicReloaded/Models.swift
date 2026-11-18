import Foundation

/// What the hidden player reports (see `web/src/bridge.ts`).
struct PlayerState: Decodable, Equatable {
    var ready = false
    var loggedIn = false
    var videoId: String?
    var title: String?
    var artist: String?
    var cover: String?
    var position: Double = 0
    var duration: Double = 0
    var paused = true
    /// The part of the playing song that plays, if one was chosen.
    var part: Part?
    /// What a best-parts run is doing ("Queueing… 3/49"), if one runs.
    var task: String?
}

/// Part of a song, in seconds; no `end`: until the song's end.
struct Part: Codable, Equatable {
    var start: Double
    var end: Double?
}

/// A song's details for "Play from…" (see `songInfo` in `bridge.ts`).
struct SongInfo: Decodable {
    let title: String
    let artist: String
    let length: Double
    let thumbnail: String?
    /// Its best part (from YouTube's "Most replayed"), if it has the data.
    let best: Part?
}

/// The song "Play from…" opens for.
struct PlayFromTarget: Identifiable {
    let videoId: String
    let title: String
    let thumbnail: String?
    var id: String { videoId }
}

/// Something on a YouTube Music page: a song, album, playlist, artist…
/// (see `web/src/pages.ts`).
struct Item: Decodable, Hashable {
    enum Kind: String, Decodable {
        case song, video, album, playlist, artist, profile, podcast, episode, page
    }

    let kind: Kind
    let title: String
    let subtitle: String
    let thumbnail: String?
    /// 16:9 cover (music videos).
    let wide: Bool
    let videoId: String?
    let duration: String?
    /// Endpoint (JSON text) that plays this item.
    let play: String?
    /// Endpoint (JSON text) that opens this item's page.
    let open: String?

    /// Songs, videos and episodes play when tapped; the rest open.
    /// Artists and profiles have round pictures.
    var round: Bool { kind == .artist || kind == .profile }

    /// Songs and videos can be played in part ("Play from…").
    var playFromTarget: PlayFromTarget? {
        guard let videoId, kind == .song || kind == .video else { return nil }
        return PlayFromTarget(videoId: videoId, title: title, thumbnail: thumbnail)
    }

    /// Songs and videos: what the like / library / playlist actions take.
    var song: SongTarget? {
        guard let videoId, kind == .song || kind == .video else { return nil }
        return SongTarget(videoId: videoId, title: title)
    }

    /// Albums and playlists: the playlist behind their Play button.
    var playlistId: String? {
        guard kind == .album || kind == .playlist else { return nil }
        return playlistIdOf(play)
    }

    var playsOnTap: Bool {
        [.song, .video, .episode].contains(kind) && play != nil
    }
}

struct PageSection: Decodable, Hashable {
    /// `cards`: one row of up to 3 cards.
    enum Style: String, Decodable { case list, carousel, grid, cards }

    var title: String?
    var style: Style
    var items: [Item]
    /// Endpoint (JSON text) of the "More" page.
    var more: String?
}

struct PageHeader: Decodable, Hashable {
    let title: String
    let subtitle: String
    let secondSubtitle: String
    let strapline: String?
    let thumbnail: String?
    let round: Bool
    let play: String?
    let shuffle: String?

    /// The playlist (or album) behind the Play button, for best parts.
    var playlistId: String? { playlistIdOf(play) }
}

/// A filter button ("Songs", "Artists", moods on Home…).
struct Chip: Decodable, Hashable {
    let title: String
    let selected: Bool
    /// Endpoint (JSON text) of the filtered page.
    let open: String
}

struct Page: Decodable {
    var header: PageHeader?
    var chips: [Chip]
    var sections: [PageSection]
    /// Rows continuing the last list section (from "load more").
    var items: [Item]
    var continuation: String?
}

struct QueueItem: Decodable, Hashable {
    let videoId: String
    let title: String
    let artist: String
    let duration: String?
    let thumbnail: String?
    let current: Bool
    /// Liked, if the queue row says (nil: ask YouTube Music).
    let liked: Bool?
}

enum QueuePosition: String {
    case next, end
}

/// The playlist a "play" endpoint (JSON text) plays.
func playlistIdOf(_ play: String?) -> String? {
    guard
        let play, let data = play.data(using: .utf8),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return nil }
    let endpoint = (json["watchPlaylistEndpoint"] ?? json["watchEndpoint"]) as? [String: Any]
    return endpoint?["playlistId"] as? String
}

/// "3:07" for 187 seconds.
func formatTime(_ seconds: Double) -> String {
    guard seconds.isFinite, seconds > 0 else { return "0:00" }
    let whole = Int(seconds)
    let hours = whole / 3600
    let minutes = whole / 60 % 60
    let rest = whole % 60
    return hours > 0
        ? String(format: "%d:%02d:%02d", hours, minutes, rest)
        : String(format: "%d:%02d", minutes, rest)
}
