import SwiftUI

/// Any YouTube Music page: optional header, then its sections.
struct PageView: View {
    @EnvironmentObject private var bridge: PlayerBridge
    let source: PageSource
    @Binding var path: [PageSource]
    @State private var page: Page?
    @State private var error: String?
    @State private var loadingMore = false

    var body: some View {
        Group {
            if let page {
                content(page)
            } else if let error {
                VStack(spacing: 12) {
                    Text(error).foregroundStyle(Theme.secondaryText)
                    Button("Try again") { Task { await load() } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Theme.background)
        .task { if page == nil { await load() } }
    }

    private func content(_ page: Page) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                if !page.chips.isEmpty {
                    ChipRow(chips: page.chips, open: open)
                }
                if let header = page.header {
                    HeaderView(header: header)
                }
                ForEach(Array(page.sections.enumerated()), id: \.offset) { index, section in
                    SectionView(
                        section: section,
                        fallbackCover: page.header?.thumbnail,
                        open: open,
                        last: index == page.sections.count - 1,
                        loadMore: { Task { await loadMore() } }
                    )
                }
                if page.sections.isEmpty && page.header == nil {
                    Text(searchText == nil ? "Nothing here yet" : "No results")
                        .foregroundStyle(Theme.secondaryText)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                }
                if loadingMore {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .padding(.vertical, 16)
        }
        .refreshable { await load() }
    }

    private var searchText: String? {
        if case .search(let text) = source { return text }
        return nil
    }

    private func open(_ endpoint: String) {
        path.append(.endpoint(endpoint))
    }

    private func load() async {
        error = nil
        do {
            switch source {
            case .endpoint(let endpoint): page = try await bridge.page(endpoint)
            case .search(let text): page = try await bridge.search(text)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Load the next part and add it: new sections, or more rows for the
    /// last list (long playlists).
    private func loadMore() async {
        guard let token = page?.continuation, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        guard let next = try? await bridge.more(token, search: searchText != nil) else { return }
        page?.continuation = next.continuation
        page?.sections += next.sections
        if !next.items.isEmpty,
           let index = page?.sections.lastIndex(where: { $0.style == .list }) {
            page?.sections[index].items += next.items
        }
    }
}

/// Filter buttons above search results and on Home (moods).
struct ChipRow: View {
    let chips: [Chip]
    let open: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(chips, id: \.self) { chip in
                    Button {
                        if !chip.selected { open(chip.open) }
                    } label: {
                        Text(chip.title)
                            .font(.system(size: 14, weight: .medium))
                            .padding(.horizontal, 12)
                            .frame(height: 32)
                            .foregroundStyle(chip.selected ? Color.black : Theme.primaryText)
                            .background(
                                chip.selected ? Color.white : Theme.field,
                                in: RoundedRectangle(cornerRadius: 8)
                            )
                    }
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.bottom, -12)
    }
}

/// Cover, title and Play / Shuffle of a playlist, album or artist page.
struct HeaderView: View {
    @EnvironmentObject private var bridge: PlayerBridge
    @AppStorage(SettingsKey.bestPartLength) private var bestPartLength =
        SettingsDefault.bestPartLength
    let header: PageHeader

    var body: some View {
        VStack(spacing: 14) {
            Cover(url: header.thumbnail, size: 220, corner: header.round ? 110 : 6)
            VStack(spacing: 6) {
                if let strapline = header.strapline {
                    Text(strapline)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.secondaryText)
                }
                Text(header.title)
                    .font(.system(size: 26, weight: .bold))
                    .multilineTextAlignment(.center)
                ForEach([header.subtitle, header.secondSubtitle].filter { !$0.isEmpty }, id: \.self) {
                    Text($0)
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.secondaryText)
                        .multilineTextAlignment(.center)
                }
            }
            HStack(spacing: 12) {
                if let play = header.play {
                    Button { bridge.playEndpoint(play) } label: {
                        Label("Play", systemImage: "play.fill")
                            .font(.system(size: 15, weight: .semibold))
                            .padding(.horizontal, 22)
                            .frame(height: 38)
                            .foregroundStyle(.black)
                            .background(.white, in: Capsule())
                    }
                }
                if let shuffle = header.shuffle {
                    Button { bridge.playEndpoint(shuffle) } label: {
                        Label("Shuffle", systemImage: "shuffle")
                            .font(.system(size: 15, weight: .semibold))
                            .padding(.horizontal, 22)
                            .frame(height: 38)
                            .background(Theme.field, in: Capsule())
                    }
                }
                if !header.round, let playlistId = header.playlistId {
                    Menu {
                        Button {
                            bridge.playBestParts(
                                playlistId, shuffle: false, partLength: bestPartLength)
                        } label: {
                            Label("Play best parts", systemImage: "sparkles")
                        }
                        Button {
                            bridge.playBestParts(
                                playlistId, shuffle: true, partLength: bestPartLength)
                        } label: {
                            Label("Shuffle best parts", systemImage: "shuffle")
                        }
                    } label: {
                        Image(systemName: "sparkles")
                            .font(.system(size: 16, weight: .semibold))
                            .frame(width: 38, height: 38)
                            .background(Theme.field, in: Circle())
                    }
                }
            }
        }
        .foregroundStyle(Theme.primaryText)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
    }
}

/// A shelf: rows, a horizontal carousel of cards, or a grid.
struct SectionView: View {
    let section: PageSection
    let fallbackCover: String?
    let open: (String) -> Void
    let last: Bool
    let loadMore: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if section.title != nil || section.more != nil {
                HStack {
                    Text(section.title ?? "")
                        .font(.system(size: 22, weight: .bold))
                        .lineLimit(1)
                    Spacer()
                    if let more = section.more {
                        Button { open(more) } label: {
                            Text("More")
                                .font(.system(size: 13, weight: .medium))
                                .padding(.horizontal, 12)
                                .frame(height: 30)
                                .overlay(Capsule().stroke(Color.white.opacity(0.2)))
                        }
                    }
                }
                .foregroundStyle(Theme.primaryText)
                .padding(.horizontal, 16)
            }
            switch section.style {
            case .list:
                LazyVStack(spacing: 0) {
                    ForEach(Array(section.items.enumerated()), id: \.offset) { index, item in
                        ItemRow(item: item, fallbackCover: fallbackCover, open: open)
                            .onAppear {
                                if last && index == section.items.count - 1 { loadMore() }
                            }
                    }
                }
            case .carousel:
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 16) {
                        ForEach(Array(section.items.enumerated()), id: \.offset) { _, item in
                            ItemCard(item: item, width: item.wide ? 260 : 150, open: open)
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .onAppear { if last { loadMore() } }
            case .cards:
                HStack(alignment: .top, spacing: 14) {
                    ForEach(0..<3, id: \.self) { index in
                        if index < section.items.count {
                            ItemCard(item: section.items[index], width: nil, open: open)
                        } else {
                            Color.clear.frame(maxWidth: .infinity)
                        }
                    }
                }
                .padding(.horizontal, 16)
            case .grid:
                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: 16, alignment: .top),
                              GridItem(.flexible(), spacing: 16, alignment: .top)],
                    spacing: 18
                ) {
                    ForEach(Array(section.items.enumerated()), id: \.offset) { _, item in
                        if item.thumbnail == nil {
                            NavigationTile(item: item, open: open)
                        } else {
                            ItemCard(item: item, width: nil, open: open)
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }
}

/// Plays or opens an item, the way tapping it in YouTube Music does.
@MainActor
private func activate(
    _ item: Item, bridge: PlayerBridge, ui: AppUI, open: (String) -> Void
) {
    // "Choose a part before playing": songs open Play from… instead.
    if item.playsOnTap, let target = item.playFromTarget,
        UserDefaults.standard.bool(forKey: SettingsKey.askOnPlay)
    {
        ui.playFrom = target
        return
    }
    if item.playsOnTap, let play = item.play {
        bridge.playEndpoint(play)
    } else if let endpoint = item.open {
        open(endpoint)
    } else if let play = item.play {
        bridge.playEndpoint(play)
    }
}

/// A row: cover, title, details, length and the ⋮ menu.
struct ItemRow: View {
    @EnvironmentObject private var bridge: PlayerBridge
    @EnvironmentObject private var ui: AppUI
    let item: Item
    var fallbackCover: String?
    let open: (String) -> Void

    var body: some View {
        HStack(spacing: 14) {
            Cover(
                url: item.thumbnail ?? fallbackCover,
                size: 48,
                corner: item.round ? 24 : 2
            )
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(
                        item.videoId != nil && bridge.state.videoId == item.videoId
                            ? Theme.accent : Theme.primaryText
                    )
                    .lineLimit(1)
                Text(item.subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if let duration = item.duration {
                Text(duration)
                    .font(.system(size: 13).monospacedDigit())
                    .foregroundStyle(Theme.secondaryText)
            }
            ItemMenu(item: item, open: open)
        }
        .padding(.leading, 16)
        .padding(.trailing, 4)
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .onTapGesture { activate(item, bridge: bridge, ui: ui, open: open) }
    }
}

/// ⋮ — Play next / Add to queue for songs, Play for albums and playlists.
struct ItemMenu: View {
    @EnvironmentObject private var bridge: PlayerBridge
    @EnvironmentObject private var ui: AppUI
    let item: Item
    let open: (String) -> Void

    var body: some View {
        Menu {
            if let videoId = item.videoId {
                Button { bridge.enqueue(videoId, .next) } label: {
                    Label("Play next", systemImage: "text.line.first.and.arrowtriangle.forward")
                }
                Button { bridge.enqueue(videoId, .end) } label: {
                    Label("Add to queue", systemImage: "text.badge.plus")
                }
                if let target = item.playFromTarget {
                    Button { ui.playFrom = target } label: {
                        Label("Play from…", systemImage: "play.square")
                    }
                }
            } else if let play = item.play {
                Button { bridge.playEndpoint(play) } label: {
                    Label("Play", systemImage: "play.fill")
                }
            }
            if !item.playsOnTap, let endpoint = item.open {
                Button { open(endpoint) } label: {
                    Label("Open", systemImage: "arrow.right")
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .rotationEffect(.degrees(90))
                .foregroundStyle(Theme.secondaryText)
                .frame(width: 36, height: 44)
                .contentShape(Rectangle())
        }
    }
}

/// A card: cover (round for artists) with title and details below.
struct ItemCard: View {
    @EnvironmentObject private var bridge: PlayerBridge
    @EnvironmentObject private var ui: AppUI
    let item: Item
    /// Fixed width in carousels; fills its grid column when nil.
    let width: CGFloat?
    let open: (String) -> Void

    var body: some View {
        VStack(alignment: item.round ? .center : .leading, spacing: 8) {
            Color.clear
                .aspectRatio(item.wide ? 16 / 9 : 1, contentMode: .fit)
                .overlay { RemoteImage(url: item.thumbnail) }
                .clipShape(
                    item.round
                        ? AnyShape(Circle()) : AnyShape(RoundedRectangle(cornerRadius: 4))
                )
            VStack(alignment: item.round ? .center : .leading, spacing: 3) {
                Text(item.title)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(2)
                Text(item.subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(2)
            }
            .multilineTextAlignment(item.round ? .center : .leading)
        }
        .frame(width: width)
        .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
        .contentShape(Rectangle())
        .onTapGesture { activate(item, bridge: bridge, ui: ui, open: open) }
        .contextMenu {
            if let videoId = item.videoId {
                Button { bridge.enqueue(videoId, .next) } label: {
                    Label("Play next", systemImage: "text.line.first.and.arrowtriangle.forward")
                }
                Button { bridge.enqueue(videoId, .end) } label: {
                    Label("Add to queue", systemImage: "text.badge.plus")
                }
                if let target = item.playFromTarget {
                    Button { ui.playFrom = target } label: {
                        Label("Play from…", systemImage: "play.square")
                    }
                }
            } else if let play = item.play {
                Button { bridge.playEndpoint(play) } label: {
                    Label("Play", systemImage: "play.fill")
                }
            }
        }
    }
}

/// Explore's text buttons ("New releases", "Charts", moods).
struct NavigationTile: View {
    let item: Item
    let open: (String) -> Void

    var body: some View {
        Button {
            if let endpoint = item.open { open(endpoint) }
        } label: {
            Text(item.title)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.primaryText)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(Theme.field, in: RoundedRectangle(cornerRadius: 8))
        }
    }
}
