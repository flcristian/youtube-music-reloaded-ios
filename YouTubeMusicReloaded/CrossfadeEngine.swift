import AVFoundation

/// Crossfade curves (as in the desktop app): volume for progress 0…1.
enum FadeCurve: String, CaseIterable, Identifiable {
    case equalPower = "equal-power", linear, steep

    var id: Self { self }
    var title: String {
        switch self {
        case .equalPower: "Equal power"
        case .linear: "Linear"
        case .steep: "Steep"
        }
    }
    func fadeIn(_ p: Double) -> Double {
        switch self {
        case .equalPower: sin(p * .pi / 2)
        case .linear: p
        case .steep: 1 - pow(1 - p, 3)
        }
    }
    func fadeOut(_ p: Double) -> Double {
        switch self {
        case .equalPower: cos(p * .pi / 2)
        case .linear: 1 - p
        case .steep: pow(1 - p, 3)
        }
    }
}

/// Plays the two songs of a crossfade natively (the page's media element
/// has no volume control on iPhone): the end of the leaving song, then the
/// start of the next one, each from audio the player already loaded (see
/// `web/src/crossfade.ts`). The page is muted meanwhile, and unmuted once
/// the new song is fully faded in — at the same spot it plays natively.
@MainActor
final class CrossfadeEngine {
    private let engine = AVAudioEngine()
    private let outgoing = AVAudioPlayerNode()
    private let incoming = AVAudioPlayerNode()
    private weak var bridge: PlayerBridge?
    var curve: () -> FadeCurve = { .equalPower }

    private var fadeId = 0
    private var duration = 5.0
    /// When the leaving song's audio runs out.
    private var outgoingEnds: Date?
    private var fadeOutFrom: Date?
    private var fadeInFrom: Date?
    private var timer: Timer?
    private var incomingFile: URL?
    private var outgoingFile: URL?
    /// After the fade: when the page said it's unmuted (the incoming song
    /// keeps playing natively until its sound is surely out).
    private var handoverFrom: Date?
    /// Stop the incoming song by then even if the page never answers.
    private var handoverDeadline: Date?
    /// The one format both players are wired with: audio in another format
    /// is converted, as rewiring mid-fade makes the other song drop out.
    private let format: AVAudioFormat

    /// After the page unmutes, how long both play before the native one goes.
    private static let handoverDelay = 0.15
    private static let handoverRamp = 0.1
    /// Players start this long after they're told to, at a set moment.
    private static let startLead = 0.1
    /// Found by ear: the page's player is heard this much later than its
    /// position says, so the native copy starts this much further in.
    private static let sync = 0.05

    init(bridge: PlayerBridge) {
        self.bridge = bridge
        let rate = AVAudioSession.sharedInstance().sampleRate
        format = AVAudioFormat(standardFormatWithSampleRate: rate > 0 ? rate : 48000, channels: 2)!
        engine.attach(outgoing)
        engine.attach(incoming)
        engine.connect(outgoing, to: engine.mainMixerNode, format: format)
        engine.connect(incoming, to: engine.mainMixerNode, format: format)
        NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.log("engine configuration changed, running=\(self?.engine.isRunning ?? false)") }
        }
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] note in
            let type = note.userInfo?[AVAudioSessionInterruptionTypeKey] ?? "-"
            Task { @MainActor in self?.log("audio session interrupted, type=\(type)") }
        }
    }

    /// A message from the page (`ytmrFade`).
    func receive(_ text: String) {
        guard
            let json = try? JSONSerialization.jsonObject(with: Data(text.utf8))
                as? [String: Any],
            let phase = json["phase"] as? String,
            let id = json["id"] as? Int
        else { return }
        if phase == "log" {
            log("page: \(json["text"] as? String ?? "")")
            return
        }
        let sentAt = (json["sentAt"] as? Double).map { Date().timeIntervalSince1970 * 1000 - $0 }
        log("\(phase) \(id) start=\(json["start"] ?? "-") at=\(json["at"] ?? "-") travel=\(sentAt.map { "\(Int($0))ms" } ?? "-")")
        switch phase {
        case "out": startOutgoing(id: id, json)
        case "in": startIncoming(id: id, json)
        case "unmuted": if id == fadeId, handoverDeadline != nil { handoverFrom = Date().addingTimeInterval(Self.handoverDelay) }
        case "cancel": if id == fadeId { fadeOutAlone() }
        default: break
        }
    }

    /// TEMPORARY: Documents/crossfade-log.txt (read over USB).
    nonisolated func log(_ line: String) {
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("crossfade-log.txt")
        let stamp = String(
            format: "%.2f", Date().timeIntervalSince1970.truncatingRemainder(dividingBy: 1000))
        let data = Data((stamp + " " + line + "\n").utf8)
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(data)
            try? handle.close()
        } else {
            try? data.write(to: url)
        }
    }

    // MARK: The two songs

    /// Where in a decoded window to start, from the message's timing.
    private struct Timing {
        let start: Double, at: Double, sentAt: Double
        init?(_ json: [String: Any]) {
            guard let start = json["start"] as? Double, let at = json["at"] as? Double,
                let sentAt = json["sentAt"] as? Double
            else { return nil }
            (self.start, self.at, self.sentAt) = (start, at, sentAt)
        }
    }

    private func startOutgoing(id: Int, _ json: [String: Any]) {
        stopAll()
        setMixing(true)
        fadeId = id
        guard let data = json["data"] as? String, let timing = Timing(json),
            let duration = json["duration"] as? Double
        else { return }
        // Decoding takes a while: off the main thread, which also runs the
        // volume ramps and the messages to the page.
        Task.detached(priority: .userInitiated) { [weak self] in
            let decoded = self?.decode(data)
            await self?.outgoingDecoded(id: id, decoded, timing, duration)
        }
    }

    private func outgoingDecoded(
        id: Int, _ decoded: (AVAudioPCMBuffer, URL)?, _ timing: Timing, _ duration: Double
    ) {
        guard id == fadeId, let (buffer, file) = decoded else {
            if let file = decoded?.1 { try? FileManager.default.removeItem(at: file) }
            if id == fadeId { setMixing(false) }
            return
        }
        self.duration = duration
        outgoingFile = file
        Task { @MainActor [weak self] in
            // Start the engine first and wait until it renders: where to
            // start in the song is only known once it can play right away
            // (a cold engine takes a few hundred ms, the song would lag).
            guard let self, await self.warmUp(), self.fadeId == id else {
                self?.log("outgoing: engine didn't start")
                self?.setMixing(false)
                return
            }
            // Start at a set moment (play() alone starts after a varying
            // delay), from where the page will be at that moment.
            let lead = Self.startLead
            let when = AVAudioTime(hostTime: mach_absolute_time() + AVAudioTime.hostTime(forSeconds: lead))
            let offset = self.offset(timing) + lead
            self.log("outgoing: \(Double(buffer.frameLength) / buffer.format.sampleRate)s from \(offset)")
            self.log("latency \(Int(self.engine.outputNode.presentationLatency * 1000))ms, sync \(Int(Self.sync * 1000))ms, route \(AVAudioSession.sharedInstance().currentRoute.outputs.map(\.portType.rawValue))")
            guard self.play(buffer, on: self.outgoing, from: offset, volume: 1, at: when) else {
                self.log("outgoing: play failed")
                self.setMixing(false)
                return
            }
            let started = Date().addingTimeInterval(lead)
            let left = Double(buffer.frameLength) / buffer.format.sampleRate - offset
            self.outgoingEnds = started.addingTimeInterval(left)
            self.startTimer()
            // Mute the page once this is heard.
            let latency = self.engine.outputNode.presentationLatency
            try? await Task.sleep(nanoseconds: UInt64((lead + latency + 0.02) * 1_000_000_000))
            guard self.fadeId == id else { return }
            self.logDrift(self.outgoing, "outgoing", since: started)
            self.bridge?.send("fadeOutStarted", ["id": id])
        }
    }

    /// Start the engine (if needed) and wait until it's rendering.
    private func warmUp() async -> Bool {
        if !engine.isRunning {
            let began = Date()
            do {
                try engine.start()
            } catch {
                log("engine: \(error)")
                return false
            }
            var first: AVAudioFramePosition?
            while Date().timeIntervalSince(began) < 1 {
                if let time = engine.outputNode.lastRenderTime, time.isSampleTimeValid {
                    if let first, time.sampleTime > first { break }
                    first = first ?? time.sampleTime
                }
                try? await Task.sleep(nanoseconds: 5_000_000)
            }
            log("engine warmed up in \(Int(Date().timeIntervalSince(began) * 1000))ms")
        }
        return engine.isRunning
    }

    private func startIncoming(id: Int, _ json: [String: Any]) {
        guard id == fadeId, let data = json["data"] as? String, let timing = Timing(json) else {
            fadeOutAlone()
            return
        }
        Task.detached(priority: .userInitiated) { [weak self] in
            let decoded = self?.decode(data)
            await self?.incomingDecoded(id: id, decoded, timing)
        }
    }

    private func incomingDecoded(id: Int, _ decoded: (AVAudioPCMBuffer, URL)?, _ timing: Timing) {
        guard id == fadeId, let (buffer, file) = decoded else {
            if let file = decoded?.1 { try? FileManager.default.removeItem(at: file) }
            log("incoming: decode failed (fade \(fadeId))")
            if id == fadeId { fadeOutAlone() }
            return
        }
        let lead = Self.startLead
        let when = AVAudioTime(hostTime: mach_absolute_time() + AVAudioTime.hostTime(forSeconds: lead))
        let offset = offset(timing) + lead
        log("incoming: \(Double(buffer.frameLength) / buffer.format.sampleRate)s from \(offset)")
        incomingFile = file
        let started = Date().addingTimeInterval(lead)
        DispatchQueue.main.asyncAfter(deadline: .now() + lead + 0.3) { [weak self] in
            guard let self, self.fadeId == id else { return }
            self.logDrift(self.incoming, "incoming", since: started)
        }
        guard play(buffer, on: incoming, from: offset, volume: 0, at: when) else {
            log("incoming: play failed")
            fadeOutAlone()
            return
        }
        // Both fade on one timeline: if the leaving song already started to
        // fade (the next one came late), the next one joins at the matching
        // volume instead of from silence.
        let now = Date()
        if fadeOutFrom == nil { fadeOutFrom = now }
        fadeInFrom = fadeOutFrom
        incoming.volume = Float(curve().fadeIn(min(1, now.timeIntervalSince(fadeInFrom!) / duration)))
        if timer == nil { startTimer() }
    }

    /// The next song didn't come (in time): the page plays it, unmuted, and
    /// the leaving song fades out over it.
    private func fadeOutAlone() {
        if fadeOutFrom == nil { fadeOutFrom = Date() }
        fadeInFrom = nil
        incoming.stop()
    }

    // MARK: Volumes

    private func startTimer() {
        timer?.invalidate()
        let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        // Common modes: keeps running while the user scrolls.
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func tick() {
        let now = Date()
        // Something (the web player switching or muting its audio) can stop
        // the engine mid-fade: start it again right away, or both songs go
        // silent until the next command.
        if !engine.isRunning, outgoing.isPlaying || incoming.isPlaying {
            log("engine stopped mid-fade, restarting")
            do {
                try AVAudioSession.sharedInstance().setActive(true)
                try engine.start()
            } catch {
                log("restart failed: \(error)")
            }
        }
        // Not faded yet but running out: start fading the leaving song.
        if fadeOutFrom == nil, let ends = outgoingEnds,
            ends.timeIntervalSince(now) <= duration
        {
            fadeOutFrom = now
        }
        let curve = curve()
        if let from = fadeOutFrom {
            let p = min(1, now.timeIntervalSince(from) / duration)
            outgoing.volume = Float(curve.fadeOut(p))
        }
        if let from = fadeInFrom {
            let p = min(1, now.timeIntervalSince(from) / duration)
            incoming.volume = Float(curve.fadeIn(p))
            if p >= 1 {
                // Hand the song back to the page at the same spot; keep
                // playing until it says it's unmuted (see `handoverFrom`).
                fadeInFrom = nil
                handoverDeadline = now.addingTimeInterval(1.5)
                log("done, outgoing playing=\(outgoing.isPlaying) incoming playing=\(incoming.isPlaying)")
                bridge?.send("fadeDone", ["id": fadeId])
            }
        }
        if let from = handoverFrom ?? handoverDeadline.flatMap({ now >= $0 ? $0 : nil }) {
            let p = now.timeIntervalSince(from) / Self.handoverRamp
            if p >= 1 {
                log("handover over\(handoverFrom == nil ? " (no answer from the page)" : "")")
                incoming.stop()
                handoverFrom = nil
                handoverDeadline = nil
            } else if p > 0 {
                incoming.volume = Float(1 - p)
            }
        }
        let outgoingOver =
            fadeOutFrom.map { now.timeIntervalSince($0) >= duration } ?? false
            || (outgoingEnds.map { now >= $0 } ?? false)
        if outgoingOver, outgoing.isPlaying { outgoing.stop() }
        if outgoingOver, fadeInFrom == nil, handoverDeadline == nil, !incoming.isPlaying {
            stopAll()
            engine.stop()
            // Let go of the session before it stops mixing: an active
            // non-mixing session interrupts the page's player.
            do {
                try AVAudioSession.sharedInstance().setActive(false)
            } catch {
                log("deactivate: \(error)")
            }
            setMixing(false)
        }
    }

    /// The page's player plays in another process, which iOS treats like
    /// another app: without mixing, each one starting interrupts the other
    /// (the pauses). Only during a fade: a mixing app gets no lock screen
    /// controls.
    private func setMixing(_ on: Bool) {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback, mode: .default, options: on ? [.mixWithOthers] : [])
            log("mixing \(on ? "on" : "off")")
        } catch {
            log("mixing \(on): \(error)")
        }
    }

    private func stopAll() {
        timer?.invalidate()
        timer = nil
        outgoing.stop()
        incoming.stop()
        fadeOutFrom = nil
        fadeInFrom = nil
        outgoingEnds = nil
        handoverFrom = nil
        handoverDeadline = nil
        for file in [outgoingFile, incomingFile].compactMap({ $0 }) {
            try? FileManager.default.removeItem(at: file)
        }
        outgoingFile = nil
        incomingFile = nil
        // The engine keeps running: restarting it reconfigures the audio
        // session, which can interrupt the page's audio.
    }

    // MARK: Audio

    /// Where to start in the buffer, so it lines up with the page: the
    /// media time it was sent at, plus the time it took to get here.
    private func offset(_ timing: Timing) -> Double {
        let travel = max(0, Date().timeIntervalSince1970 - timing.sentAt / 1000)
        return max(0, timing.at - timing.start + travel + engine.outputNode.presentationLatency + Self.sync)
    }

    /// The MP4 the page sent, decoded.
    /// The audio the page sent (base64 ADTS), decoded. Runs off the main thread.
    nonisolated private func decode(_ base64: String) -> (AVAudioPCMBuffer, URL)? {
        guard let data = Data(base64Encoded: base64) else { return nil }
        let began = Date()
        defer { log("decode took \(Int(Date().timeIntervalSince(began) * 1000))ms") }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("crossfade-\(UUID().uuidString).aac")
        do {
            try data.write(to: url)
            let file = try AVAudioFile(forReading: url)
            // Read in blocks: the file may claim more than it holds, and a
            // read past the end fails instead of returning less.
            let format = file.processingFormat
            var blocks: [AVAudioPCMBuffer] = []
            var total: AVAudioFrameCount = 0
            while true {
                guard let block = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096)
                else { break }
                do {
                    try file.read(into: block, frameCount: 4096)
                } catch {
                    log("read stopped after \(total) frames: \(error.localizedDescription)")
                    break
                }
                if block.frameLength == 0 { break }
                blocks.append(block)
                total += block.frameLength
            }
            log("decoded \(Double(total) / format.sampleRate)s, file says \(Double(file.length) / format.sampleRate)s")
            guard total > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: total)
            else { return nil }
            for block in blocks { buffer.append(block) }
            guard let converted = convert(buffer) else {
                log("convert failed from \(format)")
                return nil
            }
            return (converted, url)
        } catch {
            log("decode error: \(error)")
            try? FileManager.default.removeItem(at: url)
            return nil
        }
    }

    /// `buffer` in the format the players are wired with.
    nonisolated private func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        if buffer.format == format { return buffer }
        guard let converter = AVAudioConverter(from: buffer.format, to: format) else { return nil }
        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 4096
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
            return nil
        }
        var given = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if given {
                status.pointee = .endOfStream
                return nil
            }
            given = true
            status.pointee = .haveData
            return buffer
        }
        if let error {
            log("convert error: \(error)")
            return nil
        }
        return out
    }

    private func play(
        _ buffer: AVAudioPCMBuffer, on node: AVAudioPlayerNode, from seconds: Double,
        volume: Float, at when: AVAudioTime? = nil
    ) -> Bool {
        let rate = buffer.format.sampleRate
        let first = AVAudioFramePosition(seconds * rate)
        guard first < AVAudioFramePosition(buffer.frameLength) else { return false }
        node.stop()
        do {
            if !engine.isRunning {
                log("starting the engine")
                try engine.start()
            }
        } catch {
            log("engine: \(error)")
            return false
        }
        let part = buffer.segment(from: first)
        node.volume = volume
        node.scheduleBuffer(part, at: nil)
        node.play(at: when)
        return true
    }

    /// TEMPORARY: how far the player is from where it should be by now.
    private func logDrift(_ node: AVAudioPlayerNode, _ name: String, since started: Date) {
        guard let time = node.lastRenderTime, let played = node.playerTime(forNodeTime: time)
        else {
            log("\(name): no player time")
            return
        }
        let elapsed = Date().timeIntervalSince(started)
        let position = Double(played.sampleTime) / played.sampleRate
        log("\(name): played \(Int(position * 1000))ms of \(Int(elapsed * 1000))ms since its start")
    }
}

extension AVAudioPCMBuffer {
    /// Add `other`'s frames at the end.
    func append(_ other: AVAudioPCMBuffer) {
        guard let source = other.floatChannelData, let target = floatChannelData else { return }
        let at = Int(frameLength)
        let count = Int(other.frameLength)
        for channel in 0..<Int(format.channelCount) {
            target[channel].advanced(by: at).update(from: source[channel], count: count)
        }
        frameLength += other.frameLength
    }

    /// The frames from `first` on, as a new buffer.
    func segment(from first: AVAudioFramePosition) -> AVAudioPCMBuffer {
        let count = AVAudioFrameCount(max(0, Int64(frameLength) - first))
        let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: count)!
        out.frameLength = count
        let channels = Int(format.channelCount)
        if let source = floatChannelData, let target = out.floatChannelData {
            for channel in 0..<channels {
                target[channel].update(
                    from: source[channel].advanced(by: Int(first)), count: Int(count))
            }
        }
        return out
    }
}
