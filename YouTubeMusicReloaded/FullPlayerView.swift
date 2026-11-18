import SwiftUI

/// The expanded player: cover, seek bar, controls and "Up next".
struct FullPlayerView: View {
    @EnvironmentObject private var bridge: PlayerBridge
    @EnvironmentObject private var ui: AppUI
    @Environment(\.dismiss) private var dismiss
    @State private var queue: [QueueItem] = []
    /// Whether the playing song is liked (nil: not known yet).
    @State private var liked: Bool?

    /// Dragging the top (bar and cover) down to close: how far.
    @State private var pull: CGFloat = 0

    var body: some View {
        let state = bridge.state
        ScrollView {
            VStack(spacing: 22) {
                VStack(spacing: 22) {
                    HStack {
                        Button { dismiss() } label: {
                            Image(systemName: "chevron.down")
                                .font(.system(size: 20, weight: .semibold))
                                .frame(width: 44, height: 44)
                                // A bigger area to tap than the arrow.
                                .padding(.trailing, 56)
                                .padding(.vertical, 8)
                                .contentShape(Rectangle())
                        }
                        Spacer()
                    }

                    Cover(url: state.cover, size: 320, corner: 6)
                        .shadow(radius: 20)
                }
                .contentShape(Rectangle())
                // Drag the top down to close (like the arrow).
                .gesture(
                    DragGesture(minimumDistance: 10, coordinateSpace: .global)
                        .onChanged { drag in pull = max(0, drag.translation.height) }
                        .onEnded { drag in
                            if drag.translation.height > 120
                                || drag.predictedEndTranslation.height > 300
                            {
                                dismiss()
                            } else {
                                withAnimation(.easeOut(duration: 0.2)) { pull = 0 }
                            }
                        }
                )

                HStack(alignment: .center, spacing: 12) {
                    // Balances the like button, keeping the title centered.
                    Color.clear.frame(width: 44, height: 44)
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
                    .frame(maxWidth: .infinity)
                    likeButton(state)
                }

                WaveformSeekbar()

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

                UpNextList(queue: $queue)
            }
            .foregroundStyle(Theme.primaryText)
            .padding(.horizontal, 20)
        }
        .background(Theme.background.ignoresSafeArea())
        .offset(y: pull)
        .overlay(alignment: .bottom) {
            if let toast = ui.toast { MessageToast(text: toast) }
        }
        .sheet(item: $ui.addToPlaylist) { song in
            AddToPlaylistView(song: song)
                .environmentObject(bridge)
                .environmentObject(ui)
        }
        .task(id: state.videoId) { await loadQueue() }
        .task(id: state.videoId) { await loadLiked() }
    }

    private func likeButton(_ state: PlayerState) -> some View {
        Button {
            guard let videoId = state.videoId, let current = liked else { return }
            liked = !current
            Task {
                do {
                    try await bridge.rate(videoId, like: !current)
                } catch {
                    liked = current
                    ui.show(error.localizedDescription)
                }
            }
        } label: {
            Image(systemName: liked == true ? "hand.thumbsup.fill" : "hand.thumbsup")
                .font(.system(size: 22))
                .frame(width: 44, height: 44)
                .opacity(liked == nil ? 0.4 : 1)
        }
        .disabled(liked == nil)
    }

    private func loadLiked() async {
        liked = nil
        guard let videoId = bridge.state.videoId else { return }
        liked = try? await bridge.isLiked(videoId)
    }

    private func loadQueue() async {
        // The page updates its queue shortly after a song changes.
        for delay in [0.0, 1.5] {
            try? await Task.sleep(for: .seconds(delay))
            if let items = try? await bridge.queue() { queue = items }
        }
    }
}

/// 👍 on a queue row: shows and toggles whether the song is liked.
struct QueueLikeButton: View {
    @EnvironmentObject private var bridge: PlayerBridge
    @EnvironmentObject private var ui: AppUI
    let item: QueueItem
    @State private var liked: Bool?

    var body: some View {
        Button {
            guard let current = liked else { return }
            liked = !current
            Task {
                do {
                    try await bridge.rate(item.videoId, like: !current)
                } catch {
                    liked = current
                    ui.show(error.localizedDescription)
                }
            }
        } label: {
            Image(systemName: liked == true ? "hand.thumbsup.fill" : "hand.thumbsup")
                .font(.system(size: 16))
                .foregroundStyle(liked == true ? Theme.primaryText : Theme.secondaryText)
                .frame(width: 36, height: 44)
                .contentShape(Rectangle())
                .opacity(liked == nil ? 0.4 : 1)
        }
        .buttonStyle(.plain)
        .disabled(liked == nil)
        .task(id: item.videoId) {
            liked = item.liked
            if liked == nil { liked = try? await bridge.isLiked(item.videoId) }
        }
    }
}

/// "Up next": tap to play, ⋮ for the song's menu, drag ≡ to move it.
/// (Its own view: dragging only redraws the queue, not the whole player.)
struct UpNextList: View {
    @EnvironmentObject private var bridge: PlayerBridge
    @Binding var queue: [QueueItem]
    /// The row being dragged by its handle, and how far (in screen points:
    /// the row itself moves, so its own coordinates would shift under the
    /// finger and make it stutter).
    @State private var dragging: Int?
    @State private var dragOffset: CGFloat = 0
    /// The dropped row, gliding from where it was let go into its place.
    @State private var settling: (id: String, offset: CGFloat)?

    /// Rows with an identity that follows the song (the same song twice:
    /// its first and second time), so a move only moves that row.
    private var rows: [(id: String, index: Int, item: QueueItem)] {
        var seen: [String: Int] = [:]
        return queue.enumerated().map { index, item in
            let count = seen[item.videoId, default: 0]
            seen[item.videoId] = count + 1
            return ("\(item.videoId)#\(count)", index, item)
        }
    }

    private static let rowHeight: CGFloat = 56

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("UP NEXT")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.secondaryText)
                .padding(.bottom, 8)
            Theme.divider.frame(height: 1)
            ForEach(rows, id: \.id) { row in
                let index = row.index
                queueRow(index, row.item)
                    .offset(y: rowOffset(index) + (settling?.id == row.id ? settling!.offset : 0))
                    .zIndex(dragging == index || settling?.id == row.id ? 1 : 0)
                    // The rows making room slide; the dragged one follows
                    // the finger as is.
                    .animation(
                        dragging == index ? nil : .easeOut(duration: 0.15),
                        value: rowOffset(index))
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 30)
    }

    private func queueRow(_ index: Int, _ item: QueueItem) -> some View {
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
            QueueLikeButton(item: item)
            Menu {
                RadioActions(videoId: item.videoId)
                SongActions(song: SongTarget(videoId: item.videoId, title: item.title))
            } label: {
                Image(systemName: "ellipsis")
                    .rotationEffect(.degrees(90))
                    .foregroundStyle(Theme.secondaryText)
                    .frame(width: 28, height: 44)
                    .contentShape(Rectangle())
            }
            // Drag to move it in the queue.
            Image(systemName: "line.3.horizontal")
                .foregroundStyle(Theme.secondaryText)
                .frame(width: 32, height: 44)
                .contentShape(Rectangle())
                .highPriorityGesture(
                    DragGesture(minimumDistance: 0, coordinateSpace: .global)
                        .onChanged { drag in
                            dragging = index
                            dragOffset = drag.translation.height
                        }
                        .onEnded { _ in drop() }
                )
        }
        .frame(height: Self.rowHeight)
        .background(
            dragging == index
                ? Theme.field : item.current ? Color.white.opacity(0.08) : Theme.background
        )
        .contentShape(Rectangle())
        .onTapGesture {
            if !item.current { bridge.playQueueItem(index) }
        }
    }

    /// Where the dragged row would land.
    private var dropIndex: Int? {
        guard let from = dragging else { return nil }
        let moved = Int((dragOffset / Self.rowHeight).rounded())
        return min(max(0, from + moved), queue.count - 1)
    }

    /// The dragged row follows the finger; the rows it passes make room.
    private func rowOffset(_ index: Int) -> CGFloat {
        guard let from = dragging, let to = dropIndex else { return 0 }
        if index == from { return dragOffset }
        if from < index, index <= to { return -Self.rowHeight }
        if to <= index, index < from { return Self.rowHeight }
        return 0
    }

    private func drop() {
        guard let from = dragging, let to = dropIndex else { return }
        let id = rows[from].id
        // Where the row is now, measured from the slot it lands in.
        let left = dragOffset - CGFloat(to - from) * Self.rowHeight
        // Move it and stop dragging in one step, without animation: the
        // other rows are already where they end up, so nothing else moves.
        var instant = Transaction()
        instant.disablesAnimations = true
        withTransaction(instant) {
            if from != to {
                let item = queue.remove(at: from)
                queue.insert(item, at: to)
            }
            dragging = nil
            dragOffset = 0
            settling = (id, left)
        }
        // Then only the dropped row glides into place.
        withAnimation(.easeOut(duration: 0.18)) { settling = (id, 0) }
        Task {
            try? await Task.sleep(for: .seconds(0.25))
            if settling?.id == id { settling = nil }
        }
        guard from != to else { return }
        bridge.moveQueueItem(from: from, to: to)
        Task {
            try? await Task.sleep(for: .seconds(0.5))
            // Only if the page's queue differs from what's shown.
            if let items = try? await bridge.queue(), items != queue { queue = items }
        }
    }
}
