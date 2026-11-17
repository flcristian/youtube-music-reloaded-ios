import SwiftUI

/// Where a screen's content comes from.
enum PageSource: Hashable {
    case endpoint(String)
    case search(String)

    static func browse(_ browseId: String) -> PageSource {
        .endpoint(#"{"browseEndpoint":{"browseId":"\#(browseId)"}}"#)
    }
}

enum Tab: String, CaseIterable, Identifiable {
    case home = "Home", explore = "Explore", library = "Library"

    var id: Self { self }
    var source: PageSource {
        switch self {
        case .home: .browse("FEmusic_home")
        case .explore: .browse("FEmusic_explore")
        case .library: .browse("FEmusic_liked_playlists")
        }
    }
    var icon: String {
        switch self {
        case .home: "house.fill"
        case .explore: "safari.fill"
        case .library: "music.note.list"
        }
    }
    var outlineIcon: String {
        switch self {
        case .home: "house"
        case .explore: "safari"
        case .library: "music.note.list"
        }
    }
}

/// Top bar, tabs, the pages, and the player bar — YouTube Music's desktop
/// layout fitted to a phone (the sidebar slides in from ☰).
struct MainView: View {
    @EnvironmentObject private var bridge: PlayerBridge
    @EnvironmentObject private var ui: AppUI
    @State private var tab = Tab.home
    @State private var path: [PageSource] = []
    @State private var searching = false
    @State private var query = ""
    @State private var showSidebar = false
    @State private var showPlayer = false
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            topBar
            NavigationStack(path: $path) {
                PageView(source: tab.source, path: $path)
                    .id(tab)
                    .toolbar(.hidden, for: .navigationBar)
                    .navigationDestination(for: PageSource.self) { source in
                        PageView(source: source, path: $path)
                            .toolbarBackground(Theme.background, for: .navigationBar)
                            .navigationBarTitleDisplayMode(.inline)
                    }
            }
            if let task = bridge.state.task {
                TaskToast(text: task)
            }
            if bridge.state.videoId != nil {
                PlayerBar { showPlayer = true }
            }
            bottomBar
        }
        .background(Theme.background.ignoresSafeArea())
        .overlay { sidebar }
        .fullScreenCover(isPresented: $showPlayer) { FullPlayerView() }
        .sheet(item: $ui.playFrom) { target in
            PlayFromView(target: target)
                .environmentObject(bridge)
        }
        .sheet(isPresented: $ui.showSettings) { SettingsView() }
    }

    // MARK: Top bar

    private var topBar: some View {
        VStack(spacing: 10) {
            HStack(spacing: 4) {
                if searching {
                    searchField
                    Button("Cancel") {
                        searching = false
                        query = ""
                    }
                    .padding(.leading, 8)
                } else {
                    Button { withAnimation(.easeOut(duration: 0.2)) { showSidebar = true } } label: {
                        Image(systemName: "line.3.horizontal")
                            .font(.system(size: 20))
                            .frame(width: 44, height: 44)
                    }
                    logo
                    Spacer()
                    Button { ui.showSettings = true } label: {
                        Image(systemName: "gearshape")
                            .font(.system(size: 20))
                            .frame(width: 44, height: 44)
                    }
                    Button {
                        searching = true
                        searchFocused = true
                    } label: {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 20))
                            .frame(width: 44, height: 44)
                    }
                }
            }
            .frame(height: 44)
        }
        .foregroundStyle(Theme.primaryText)
        .padding(.horizontal, 10)
        .padding(.bottom, 4)
        .background(Theme.background)
        .overlay(alignment: .bottom) { Theme.divider.frame(height: 1) }
    }

    private var logo: some View {
        HStack(spacing: 5) {
            Image(systemName: "play.circle.fill")
                .font(.system(size: 24))
                .foregroundStyle(.white, Theme.accent)
            Text("Music")
                .font(.system(size: 20, weight: .bold))
                .tracking(-0.8)
        }
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Theme.secondaryText)
            TextField(
                "",
                text: $query,
                prompt: Text("Search songs, albums, artists")
                    .foregroundStyle(Theme.secondaryText)
            )
            .focused($searchFocused)
            .submitLabel(.search)
            .autocorrectionDisabled()
            .onSubmit {
                let text = query.trimmingCharacters(in: .whitespaces)
                if !text.isEmpty { path.append(.search(text)) }
            }
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Theme.secondaryText)
                }
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 38)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 8))
        .padding(.leading, 6)
    }

    /// Home / Explore / Library, like the YouTube Music app.
    private var bottomBar: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases) { item in
                Button { select(item) } label: {
                    VStack(spacing: 4) {
                        Image(systemName: tab == item ? item.icon : item.outlineIcon)
                            .font(.system(size: 20))
                            .frame(height: 24)
                        Text(item.rawValue)
                            .font(.system(size: 10, weight: .medium))
                    }
                    .foregroundStyle(tab == item ? Theme.primaryText : Theme.secondaryText)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
                    .padding(.bottom, 4)
                    .contentShape(Rectangle())
                }
            }
        }
        .background(Theme.surface.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Theme.divider.frame(height: 1) }
    }

    private func select(_ item: Tab) {
        tab = item
        path = []
    }

    // MARK: Sidebar

    @ViewBuilder
    private var sidebar: some View {
        if showSidebar {
            ZStack(alignment: .leading) {
                Color.black.opacity(0.5)
                    .ignoresSafeArea()
                    .onTapGesture { closeSidebar() }
                Sidebar { destination in
                    closeSidebar()
                    switch destination {
                    case .tab(let item): select(item)
                    case .page(let source):
                        path = [source]
                    }
                }
                .frame(width: 280)
                .transition(.move(edge: .leading))
            }
            .transition(.opacity)
        }
    }

    private func closeSidebar() {
        withAnimation(.easeOut(duration: 0.2)) { showSidebar = false }
    }
}

/// The desktop sidebar: Home, Explore, Library, then your playlists.
struct Sidebar: View {
    enum Destination {
        case tab(Tab)
        case page(PageSource)
    }

    @EnvironmentObject private var bridge: PlayerBridge
    let go: (Destination) -> Void
    @State private var playlists: [Item] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Tab.allCases) { item in
                    Button { go(.tab(item)) } label: {
                        HStack(spacing: 20) {
                            Image(systemName: item.icon).frame(width: 24)
                            Text(item.rawValue).font(.system(size: 16, weight: .medium))
                            Spacer()
                        }
                        .frame(height: 48)
                        .padding(.horizontal, 20)
                        .contentShape(Rectangle())
                    }
                }
                Theme.divider.frame(height: 1).padding(.vertical, 12).padding(.horizontal, 20)
                ForEach(playlists, id: \.self) { playlist in
                    Button {
                        if let open = playlist.open { go(.page(.endpoint(open))) }
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(playlist.title)
                                .font(.system(size: 15, weight: .medium))
                                .lineLimit(1)
                            Text(playlist.subtitle)
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.secondaryText)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                    }
                }
            }
            .padding(.top, 8)
        }
        .foregroundStyle(Theme.primaryText)
        .background(Theme.background.ignoresSafeArea())
        .overlay(alignment: .trailing) { Theme.divider.frame(width: 1).ignoresSafeArea() }
        .task {
            guard case .endpoint(let library) = Tab.library.source,
                  let page = try? await bridge.page(library) else { return }
            playlists = page.sections.flatMap(\.items).filter { $0.kind == .playlist }
        }
    }
}

/// A best-parts run's progress ("Finding best parts… 12/50").
struct TaskToast: View {
    let text: String

    var body: some View {
        HStack(spacing: 10) {
            ProgressView()
                .tint(Theme.accent)
            Text(text)
                .font(.system(size: 14))
                .foregroundStyle(Theme.primaryText)
                .lineLimit(1)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface)
        .overlay(alignment: .top) { Theme.divider.frame(height: 1) }
    }
}
