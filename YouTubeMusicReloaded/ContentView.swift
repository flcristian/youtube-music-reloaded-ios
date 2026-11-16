import SwiftUI

struct ContentView: View {
    @StateObject private var player = Player()
    @State private var showDiagnostics = false

    var body: some View {
        WebView(webView: player.webView)
            .ignoresSafeArea(edges: .bottom)
            .overlay(alignment: .topTrailing) {
                Button {
                    showDiagnostics = true
                } label: {
                    Image(systemName: "stethoscope")
                        .font(.system(size: 14, weight: .semibold))
                        .padding(8)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .padding(.trailing, 8)
                .accessibilityLabel("Diagnostics")
            }
            .sheet(isPresented: $showDiagnostics) {
                DiagnosticsView(player: player)
            }
    }
}
