import SwiftUI

/// The bottom player bar: progress line, song, controls. Tap to expand.
struct PlayerBar: View {
    @EnvironmentObject private var bridge: PlayerBridge
    let open: () -> Void

    var body: some View {
        let state = bridge.state
        VStack(spacing: 0) {
            TimelineView(.periodic(from: .now, by: 0.5)) { context in
                GeometryReader { geometry in
                    let fraction = state.duration > 0
                        ? bridge.position(at: context.date) / state.duration : 0
                    ZStack(alignment: .leading) {
                        Theme.divider
                        Theme.accent.frame(width: geometry.size.width * fraction)
                    }
                }
            }
            .frame(height: 2)

            HStack(spacing: 12) {
                Cover(url: state.cover, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.title ?? "")
                        .font(.system(size: 14, weight: .medium))
                        .lineLimit(1)
                    Text(state.artist ?? "")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Button(action: bridge.previous) {
                    Image(systemName: "backward.end.fill").frame(width: 36, height: 44)
                }
                Button(action: bridge.togglePlayPause) {
                    Image(systemName: state.paused ? "play.fill" : "pause.fill")
                        .font(.system(size: 22))
                        .frame(width: 40, height: 44)
                }
                Button(action: bridge.next) {
                    Image(systemName: "forward.end.fill").frame(width: 36, height: 44)
                }
            }
            .foregroundStyle(Theme.primaryText)
            .padding(.leading, 12)
            .padding(.trailing, 6)
            .padding(.vertical, 6)
        }
        .background(Theme.surface.ignoresSafeArea(edges: .bottom))
        .contentShape(Rectangle())
        .onTapGesture(perform: open)
    }
}
