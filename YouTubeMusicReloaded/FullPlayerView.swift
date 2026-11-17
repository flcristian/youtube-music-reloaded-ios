import SwiftUI

/// The expanded player: cover, seek bar, controls and "Up next".
struct FullPlayerView: View {
    @EnvironmentObject private var bridge: PlayerBridge
    @Environment(\.dismiss) private var dismiss
    @State private var queue: [QueueItem] = []
    /// While dragging the seek bar, the position being chosen.
    @State private var scrubbing: Double?

    var body: some View {
        let state = bridge.state
        ScrollView {
            VStack(spacing: 22) {
                HStack {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.down")
                            .font(.system(size: 20, weight: .semibold))
                            .frame(width: 44, height: 44)
                    }
                    Spacer()
                }

                Cover(url: state.cover, size: 320, corner: 6)
                    .shadow(radius: 20)

                VStack(spacing: 4) {
                    Text(state.title ?? "")
                        .font(.system(size: 22, weight: .bold))
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                    Text(state.artist ?? "")
                        .font(.system(size: 16))
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                }

                seekBar(state)

                HStack(spacing: 44) {
                    Button(action: bridge.previous) {
                        Image(systemName: "backward.end.fill").font(.system(size: 28))
                    }
                    Button(action: bridge.togglePlayPause) {
                        Image(systemName: state.paused ? "play.circle.fill" : "pause.circle.fill")
                            .font(.system(size: 68))
                    }
                    Button(action: bridge.next) {
                        Image(systemName: "forward.end.fill").font(.system(size: 28))
                    }
                }

                upNext
            }
            .foregroundStyle(Theme.primaryText)
            .padding(.horizontal, 20)
        }
        .background(Theme.background.ignoresSafeArea())
        .task(id: state.videoId) { await loadQueue() }
    }

    private func seekBar(_ state: PlayerState) -> some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { context in
            let position = scrubbing ?? bridge.position(at: context.date)
            VStack(spacing: 2) {
                Slider(
                    value: Binding(
                        get: { position },
                        set: { scrubbing = $0 }
                    ),
                    in: 0...max(state.duration, 1)
                ) { editing in
                    if !editing, let target = scrubbing {
                        bridge.seek(to: target)
                        scrubbing = nil
                    }
                }
                .tint(Theme.accent)
                HStack {
                    Text(formatTime(position))
                    Spacer()
                    Text(formatTime(state.duration))
                }
                .font(.system(size: 12).monospacedDigit())
                .foregroundStyle(Theme.secondaryText)
            }
        }
    }

    private var upNext: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("UP NEXT")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.secondaryText)
                .padding(.bottom, 8)
            Theme.divider.frame(height: 1)
            ForEach(Array(queue.enumerated()), id: \.offset) { index, item in
                HStack(spacing: 12) {
                    Cover(url: item.thumbnail, size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(item.current ? Theme.accent : Theme.primaryText)
                            .lineLimit(1)
                        Text(item.artist)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    if let duration = item.duration {
                        Text(duration)
                            .font(.system(size: 12).monospacedDigit())
                            .foregroundStyle(Theme.secondaryText)
                    }
                }
                .padding(.vertical, 8)
                .background(item.current ? Color.white.opacity(0.08) : .clear)
                .contentShape(Rectangle())
                .onTapGesture {
                    if !item.current { bridge.playQueueItem(index) }
                }
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 30)
    }

    private func loadQueue() async {
        // The page updates its queue shortly after a song changes.
        for delay in [0.0, 1.5] {
            try? await Task.sleep(for: .seconds(delay))
            if let items = try? await bridge.queue() { queue = items }
        }
    }
}
