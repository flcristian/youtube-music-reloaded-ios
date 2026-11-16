# YouTube Music Reloaded (iOS)

iOS version of [YouTube Music Reloaded](https://github.com/flcristian/youtube-music-reloaded):
YouTube Music (with a Premium account) in a native Swift app, with our features
injected into the page.

## Status

Step 1: feasibility test. The app shows YouTube Music with background audio
enabled, and a **Diagnostics** screen (stethoscope button, top right) that
checks on a real iPhone:

- whether playback continues with the screen locked / app in the background;
- whether the player's volume can be controlled through Web Audio (needed for
  crossfades — on iPhone, a media element's `volume` is read-only);
- how YouTube Music streams (MediaSource / ManagedMediaSource).

## Run on your iPhone

1. Open `YouTubeMusicReloaded.xcodeproj` in Xcode.
2. Target **YouTubeMusicReloaded → Signing & Capabilities**: pick your team
   (and change the bundle identifier if it's taken).
3. Select your iPhone and press Run.

To inspect the page: enable **Settings → Safari → Advanced → Web Inspector**
on the iPhone, then **Safari → Develop → (iPhone)** on the Mac (debug builds).

## How it works

- `Player.swift` — the `WKWebView` (desktop Safari user agent: our features are
  written for the desktop site, and Google blocks sign-in from embedded
  browser agents) and the scripts injected at document start.
- `Scripts/` — JavaScript injected into the page (`keep-visible.js` keeps the
  page "visible" so it plays in the background; `diagnostics.js`).
- `Support/Info.plist` — the `audio` background mode.
