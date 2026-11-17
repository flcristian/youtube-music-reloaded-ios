import SwiftUI

/// The app's own settings (the desktop app's seamless-crossfade options
/// that work here).
enum SettingsKey {
    static let bestPartLength = "bestPartLength"
    static let askOnPlay = "askOnPlay"
}

enum SettingsDefault {
    static let bestPartLength = 120.0
}

/// Shortest and longest "best part", in seconds (as on the desktop).
let partLengthRange = 30.0...300.0

/// UI state shared between screens: the "Play from…" sheet and settings.
@MainActor
final class AppUI: ObservableObject {
    @Published var playFrom: PlayFromTarget?
    @Published var showSettings = false
}

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage(SettingsKey.bestPartLength) private var bestPartLength =
        SettingsDefault.bestPartLength
    @AppStorage(SettingsKey.askOnPlay) private var askOnPlay = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Best part length")
                            Spacer()
                            Text(formatTime(bestPartLength))
                                .monospacedDigit()
                                .foregroundStyle(Theme.secondaryText)
                        }
                        Slider(value: $bestPartLength, in: partLengthRange, step: 10)
                            .tint(Theme.accent)
                    }
                    Toggle("Choose a part before playing", isOn: $askOnPlay)
                        .tint(Theme.accent)
                } header: {
                    Text("Play from / best parts")
                } footer: {
                    Text(
                        "Best parts come from YouTube's \"Most replayed\" data. "
                            + "With \"Choose a part before playing\" on, tapping a song "
                            + "opens Play from… instead of playing it.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}
