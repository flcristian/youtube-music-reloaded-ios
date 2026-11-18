import SwiftUI

/// The app's own settings (the desktop app's seamless-crossfade options
/// that work here).
enum SettingsKey {
    static let bestPartLength = "bestPartLength"
    static let askOnPlay = "askOnPlay"
    static let crossfadeEnabled = "crossfadeEnabled"
    static let crossfadeAuto = "crossfadeAuto"
    static let crossfadeAutoDuration = "crossfadeAutoDuration"
    static let crossfadeManual = "crossfadeManual"
    static let crossfadeManualDuration = "crossfadeManualDuration"
    static let crossfadeCurve = "crossfadeCurve"
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
    /// "Add to playlist" is open for this song.
    @Published var addToPlaylist: SongTarget?
    /// A short message above the player bar ("Added to Liked songs").
    @Published var toast: String?
}

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var bridge: PlayerBridge
    @AppStorage(SettingsKey.crossfadeEnabled) private var crossfadeEnabled = false
    @AppStorage(SettingsKey.crossfadeAuto) private var crossfadeAuto = true
    @AppStorage(SettingsKey.crossfadeAutoDuration) private var autoDuration = 5.0
    @AppStorage(SettingsKey.crossfadeManual) private var crossfadeManual = true
    @AppStorage(SettingsKey.crossfadeManualDuration) private var manualDuration = 5.0
    @AppStorage(SettingsKey.crossfadeCurve) private var curve = FadeCurve.equalPower.rawValue
    @AppStorage(SettingsKey.bestPartLength) private var bestPartLength =
        SettingsDefault.bestPartLength
    @AppStorage(SettingsKey.askOnPlay) private var askOnPlay = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Seamless Crossfade", isOn: $crossfadeEnabled)
                        .tint(Theme.accent)
                    if crossfadeEnabled {
                        Toggle("Crossfade at the end of a song", isOn: $crossfadeAuto)
                            .tint(Theme.accent)
                        if crossfadeAuto {
                            seconds("Duration", $autoDuration)
                        }
                        Toggle("Crossfade when changing songs manually", isOn: $crossfadeManual)
                            .tint(Theme.accent)
                        if crossfadeManual {
                            seconds("Duration", $manualDuration)
                        }
                        Picker("Fade curve", selection: $curve) {
                            ForEach(FadeCurve.allCases) { curve in
                                Text(curve.title).tag(curve.rawValue)
                            }
                        }
                    }
                } footer: {
                    Text(
                        "The song you leave keeps playing and fades out while the next one "
                            + "fades in, from audio that's already downloaded.")
                }
                .onChange(of: crossfadeEnabled) { bridge.applyCrossfadeSettings() }
                .onChange(of: crossfadeAuto) { bridge.applyCrossfadeSettings() }
                .onChange(of: autoDuration) { bridge.applyCrossfadeSettings() }
                .onChange(of: crossfadeManual) { bridge.applyCrossfadeSettings() }
                .onChange(of: manualDuration) { bridge.applyCrossfadeSettings() }

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

    /// A seconds slider (0.5–20 s, as on the desktop).
    private func seconds(_ title: String, _ value: Binding<Double>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                Spacer()
                Text(String(format: "%.1f s", value.wrappedValue))
                    .monospacedDigit()
                    .foregroundStyle(Theme.secondaryText)
            }
            Slider(value: value, in: 0.5...20, step: 0.5)
                .tint(Theme.accent)
        }
    }
}
