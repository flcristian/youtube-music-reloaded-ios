import SwiftUI

/// "Play from…": choose the part of a song to play (drag the start and
/// end), or its best part, then play it now or queue it.
struct PlayFromView: View {
    @EnvironmentObject private var bridge: PlayerBridge
    @Environment(\.dismiss) private var dismiss
    @AppStorage(SettingsKey.bestPartLength) private var bestPartLength =
        SettingsDefault.bestPartLength
    let target: PlayFromTarget

    @State private var info: SongInfo?
    @State private var error: String?
    @State private var start = 0.0
    /// `nil`: until the song's end.
    @State private var end: Double?

    /// Shortest part that can be chosen, in seconds.
    private static let minimum = 5.0

    private var length: Double { info?.length ?? 0 }
    private var part: Part { Part(start: start, end: end) }
    private var range: String { "\(formatTime(start)) – \(formatTime(end ?? length))" }

    var body: some View {
        VStack(spacing: 18) {
            Cover(url: info?.thumbnail ?? target.thumbnail, size: 220, corner: 8)
                .padding(.top, 28)
            VStack(spacing: 4) {
                Text(info?.title ?? target.title)
                    .font(.system(size: 18, weight: .bold))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                if let artist = info?.artist, !artist.isEmpty {
                    Text(artist)
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.secondaryText)
                }
            }
            .padding(.horizontal, 24)

            RangeBar(length: length, start: $start, end: $end, minimum: Self.minimum)
                .frame(height: 44)
                .padding(.horizontal, 24)
                .disabled(info == nil)
            Text(info == nil ? (error ?? "Loading…") : "\(range) / \(formatTime(length))")
                .font(.system(size: 13).monospacedDigit())
                .foregroundStyle(Theme.secondaryText)

            buttons
                .padding(.horizontal, 24)
            Spacer(minLength: 0)
        }
        .foregroundStyle(Theme.primaryText)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.surface.ignoresSafeArea())
        .presentationDragIndicator(.visible)
        .task { await load() }
    }

    private var buttons: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Button("Best part") {
                    guard let best = info?.best else { return }
                    start = best.start
                    end = best.end
                }
                .buttonStyle(PillStyle())
                .disabled(info?.best == nil)
                Button("Play next") { queue(.next) }
                    .buttonStyle(PillStyle())
                Button("Add to queue") { queue(.end) }
                    .buttonStyle(PillStyle())
            }
            .disabled(info == nil)
            Button {
                bridge.play(target.videoId, part: part)
                dismiss()
            } label: {
                Text(info == nil ? "Play" : "Play \(range)")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.black)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(.white, in: Capsule())
            }
            .disabled(info == nil)
            if info != nil, info?.best == nil {
                Text("No \"Most replayed\" data for this song.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.secondaryText)
            }
        }
    }

    private func queue(_ position: QueuePosition) {
        bridge.enqueue(target.videoId, position, part: part)
        dismiss()
    }

    private func load() async {
        do {
            let loaded = try await bridge.songInfo(
                target.videoId, bestPartLength: bestPartLength)
            info = loaded
            start = 0
            end = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// The song's timeline with the chosen part; dragging moves whichever end
/// is closer to the finger.
struct RangeBar: View {
    let length: Double
    @Binding var start: Double
    @Binding var end: Double?
    let minimum: Double
    @State private var dragsStart = true

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let x = { (seconds: Double) in length > 0 ? width * seconds / length : 0 }
            let endValue = end ?? length
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Theme.field)
                    .frame(height: 6)
                Rectangle()
                    .fill(Theme.accent)
                    .frame(width: max(0, x(endValue) - x(start)), height: 6)
                    .offset(x: x(start))
                handle.offset(x: x(start) - 9)
                handle.offset(x: x(endValue) - 9)
            }
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { drag in
                        guard length > 0 else { return }
                        let at = min(length, max(0, drag.location.x / width * length))
                        if drag.translation == .zero {
                            dragsStart = abs(at - start) <= abs(at - endValue)
                        }
                        if dragsStart {
                            start = max(0, min(at, endValue - minimum))
                        } else {
                            let value = max(at, start + minimum)
                            // Dragged to the very end: until the song's end.
                            end = value >= length - 0.5 ? nil : value
                        }
                    }
            )
        }
    }

    private var handle: some View {
        Circle()
            .fill(.white)
            .frame(width: 18, height: 18)
    }
}

/// A gray rounded button (the desktop dialog's secondary buttons).
struct PillStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .medium))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(maxWidth: .infinity, minHeight: 38)
            .background(
                Theme.field.opacity(configuration.isPressed ? 0.6 : 1), in: Capsule()
            )
            .opacity(isEnabled ? 1 : 0.4)
    }
}
