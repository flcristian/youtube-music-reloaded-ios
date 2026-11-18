import AVFoundation
import SwiftUI

/// Songs' waveforms, built from the audio the player loads (the whole file
/// can't be downloaded here, unlike on desktop): each loaded stretch fills
/// in its part, the same loudness math as the desktop app.
@MainActor
final class WaveformStore: ObservableObject {
    /// Bars per song (drawn resampled to the width).
    static let count = 1000
    /// Height of the quietest bars, so they stay visible.
    private static let minLevel: Float = 0.12

    private struct Song {
        var sums = [Double](repeating: 0, count: WaveformStore.count)
        var counts = [Int](repeating: 0, count: WaveformStore.count)
        /// Stretches already added (by start, in ms).
        var added = Set<Int>()
        var levels = [Float?](repeating: nil, count: WaveformStore.count)
    }

    private var songs: [String: Song] = [:]
    private var order: [String] = []
    /// Bumped when a song's waveform changes.
    @Published private(set) var version = 0

    /// 0–1 per bar; nil: not loaded yet.
    func levels(_ videoId: String?) -> [Float?]? {
        videoId.flatMap { songs[$0]?.levels }
    }

    /// A message from the page (`ytmrWave`): a loaded stretch of a song.
    func receive(_ text: String) {
        guard
            let json = try? JSONSerialization.jsonObject(with: Data(text.utf8))
                as? [String: Any],
            let videoId = json["videoId"] as? String,
            let duration = json["duration"] as? Double, duration > 0,
            let start = json["start"] as? Double,
            let data = json["data"] as? String
        else { return }
        let key = Int((start * 1000).rounded())
        if songs[videoId]?.added.contains(key) == true { return }
        Task.detached(priority: .utility) {
            guard let bins = Self.energy(of: data, from: start, duration: duration) else { return }
            await self.add(bins, to: videoId, key: key)
        }
    }

    private func add(_ bins: [Int: (Double, Int)], to videoId: String, key: Int) {
        var song = songs[videoId] ?? Song()
        guard !song.added.contains(key) else { return }
        song.added.insert(key)
        for (bin, (sum, count)) in bins {
            song.sums[bin] += sum
            song.counts[bin] += count
        }
        song.levels = Self.levels(song)
        songs[videoId] = song
        order.removeAll { $0 == videoId }
        order.append(videoId)
        if order.count > 30 { songs[order.removeFirst()] = nil }
        version += 1
    }

    /// RMS on a dB scale, stretched over this song's own loudness range
    /// (ignoring the quietest 10% and the loudest 1%) — as on desktop.
    private static func levels(_ song: Song) -> [Float?] {
        let db: [Double?] = (0..<count).map { i in
            song.counts[i] > 0
                ? 10 * log10(song.sums[i] / Double(song.counts[i]) + 1e-12) : nil
        }
        let known = db.compactMap { $0 }.sorted()
        guard !known.isEmpty else { return [Float?](repeating: nil, count: count) }
        let low = known[Int(Double(known.count) * 0.1)]
        let high = known[min(known.count - 1, Int(Double(known.count) * 0.99))]
        let span = max(1, high - low)
        return db.map { value in
            guard let value else { return nil }
            let relative = Float(min(1, max(0, (value - low) / span)))
            return minLevel + (1 - minLevel) * relative
        }
    }

    /// Sum of squares and sample count per bar, for a stretch of audio.
    nonisolated private static func energy(
        of base64: String, from start: Double, duration: Double
    ) -> [Int: (Double, Int)]? {
        guard let data = Data(base64Encoded: base64) else { return nil }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("wave-\(UUID().uuidString).aac")
        defer { try? FileManager.default.removeItem(at: url) }
        guard (try? data.write(to: url)) != nil, let file = try? AVAudioFile(forReading: url)
        else { return nil }
        let format = file.processingFormat
        let rate = format.sampleRate
        var bins: [Int: (Double, Int)] = [:]
        var frame = 0
        while true {
            guard let block = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096) else { break }
            // A read past the end fails instead of returning less.
            guard (try? file.read(into: block, frameCount: 4096)) != nil, block.frameLength > 0
            else { break }
            guard let channels = block.floatChannelData else { break }
            for i in 0..<Int(block.frameLength) {
                let time = start + Double(frame + i) / rate
                let bin = Int(time / duration * Double(count))
                guard bin >= 0, bin < count else { continue }
                var sum = 0.0
                for channel in 0..<Int(format.channelCount) {
                    let sample = Double(channels[channel][i])
                    sum += sample * sample
                }
                let old = bins[bin] ?? (0, 0)
                bins[bin] = (old.0 + sum, old.1 + Int(format.channelCount))
            }
            frame += Int(block.frameLength)
        }
        return bins.isEmpty ? nil : bins
    }
}

/// The desktop waveform seekbar: bars with a reflection, the part that
/// plays in red (played: solid, still to play: lighter), the rest white.
/// Tap or drag to seek; drag the white line at the part's end to move it.
struct WaveformSeekbar: View {
    @EnvironmentObject private var bridge: PlayerBridge
    @EnvironmentObject private var waveforms: WaveformStore
    @AppStorage(SettingsKey.crossfadeEnabled) private var crossfadeEnabled = false
    @AppStorage(SettingsKey.crossfadeAuto) private var crossfadeAuto = true
    @AppStorage(SettingsKey.crossfadeAutoDuration) private var autoDuration = 5.0

    /// While dragging: seeking, or moving the part's end.
    @State private var dragging: Drag?
    /// While seeking by drag, the share being shown.
    @State private var scrub: Double?
    @State private var lastSeek = Date.distantPast

    private enum Drag { case seek, end }

    private static let height: CGFloat = 56
    private static let barWidth: CGFloat = 2
    private static let barGap: CGFloat = 1
    /// Share of the height used by the bars; the rest is their reflection.
    private static let topShare: CGFloat = 0.7
    /// Bar height while there is no waveform (still shows progress).
    private static let flat: Float = 0.04
    /// How close to the end line a press grabs it instead of seeking.
    private static let grabDistance: CGFloat = 18
    /// The end can't come closer to the position than the end-of-song
    /// crossfade plus this.
    private static let minRemaining = 5.0

    private static let played = Color(red: 1, green: 0, blue: 0.2)
    private static let playedReflection = Color(red: 1, green: 0, blue: 0.2).opacity(0.45)
    private static let upcoming = Color(red: 1, green: 0, blue: 0.2).opacity(0.5)
    private static let upcomingReflection = Color(red: 1, green: 0, blue: 0.2).opacity(0.22)
    private static let unplayed = Color.white.opacity(0.45)
    private static let unplayedReflection = Color.white.opacity(0.2)

    var body: some View {
        let state = bridge.state
        let levels = waveforms.levels(state.videoId)
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { context in
            let duration = max(state.duration, 0)
            let progress = scrub ?? (duration > 0 ? bridge.position(at: context.date) / duration : 0)
            let (from, to) = partShares(state)
            VStack(spacing: 2) {
                GeometryReader { geometry in
                    Canvas { canvas, size in
                        draw(canvas, size: size, levels: levels, from: from, to: to, progress: progress)
                    }
                    .contentShape(Rectangle())
                    .gesture(drag(width: geometry.size.width, endShare: to))
                }
                .frame(height: Self.height)
                HStack {
                    Text(formatTime(progress * duration))
                    Spacer()
                    Text(formatTime(duration))
                }
                .font(.system(size: 12).monospacedDigit())
                .foregroundStyle(Theme.secondaryText)
            }
        }
    }

    /// The playing part as shares of the song (whole song if none).
    private func partShares(_ state: PlayerState) -> (Double, Double) {
        guard let part = state.part, state.duration > 0 else { return (0, 1) }
        let share = { (seconds: Double) in min(1, max(0, seconds / state.duration)) }
        return (share(part.start), part.end.map(share) ?? 1)
    }

    private func draw(
        _ canvas: GraphicsContext, size: CGSize, levels: [Float?]?, from: Double, to: Double,
        progress: Double
    ) {
        let width = size.width
        let height = size.height
        let bars = Int(width / (Self.barWidth + Self.barGap))
        guard bars > 0 else { return }
        let lit = (Int((from * Double(bars)).rounded()), Int((to * Double(bars)).rounded()))
        let playedBars = Int((progress * Double(bars)).rounded())
        let baseline = height * Self.topShare
        for i in 0..<bars {
            var level = Self.flat
            if let levels {
                let a = i * WaveformStore.count / bars
                let b = max(a + 1, (i + 1) * WaveformStore.count / bars)
                var peak: Float = 0
                for p in a..<min(b, WaveformStore.count) { peak = max(peak, levels[p] ?? 0) }
                level = max(Self.flat, peak)
            }
            let isLit = i >= lit.0 && i < lit.1
            let isUpcoming = isLit && i >= playedBars
            let x = CGFloat(i) * (Self.barWidth + Self.barGap)
            let up = CGFloat(level) * (baseline - 2)
            let down = CGFloat(level) * (height - baseline - 1)
            canvas.fill(
                Path(CGRect(x: x, y: baseline - up, width: Self.barWidth, height: up)),
                with: .color(isUpcoming ? Self.upcoming : isLit ? Self.played : Self.unplayed))
            canvas.fill(
                Path(CGRect(x: x, y: baseline + 1, width: Self.barWidth, height: down)),
                with: .color(
                    isUpcoming
                        ? Self.upcomingReflection : isLit ? Self.playedReflection : Self.unplayedReflection))
        }
        // The line at the part's end (drag it to move the end).
        let at = min(width - 2, max(0, to * width - 1))
        canvas.fill(Path(CGRect(x: at, y: 0, width: 2, height: height)), with: .color(.white))
    }

    private func drag(width: CGFloat, endShare: Double) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { drag in
                guard width > 0 else { return }
                if dragging == nil {
                    let endX = endShare * width
                    dragging = abs(drag.startLocation.x - endX) <= Self.grabDistance ? .end : .seek
                }
                apply(share: min(1, max(0, drag.location.x / width)), final: false)
            }
            .onEnded { drag in
                guard width > 0 else { return }
                apply(share: min(1, max(0, drag.location.x / width)), final: true)
                dragging = nil
                scrub = nil
            }
    }

    private func apply(share: Double, final: Bool) {
        let duration = bridge.state.duration
        guard duration > 0 else { return }
        switch dragging {
        case .end:
            let fade = crossfadeEnabled && crossfadeAuto ? autoDuration : 0
            let earliest = min(duration, bridge.position() + fade + Self.minRemaining)
            let end = max(earliest, share * duration)
            // Dragged to the very end: play until the song's end.
            bridge.setPartEnd(end >= duration - 0.5 ? nil : end)
        case .seek, nil:
            scrub = share
            // Seek as the finger moves (not on every move: each goes to
            // the page), and where it's let go.
            if final || Date().timeIntervalSince(lastSeek) > 0.2 {
                lastSeek = Date()
                bridge.seek(to: share * duration)
            }
        }
    }
}
