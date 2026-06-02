# SVX Portal — Desktop App

[![Build & Release](https://github.com/Guru-RF/SvxPortalApp/actions/workflows/release.yml/badge.svg)](https://github.com/Guru-RF/SvxPortalApp/actions/workflows/release.yml)

A desktop application for monitoring the [SVX Reflector](https://github.com/sm0svx/svxlink) network in real time.  
Built with [Electron](https://www.electronjs.org/), available for **macOS**, **Windows**, and **Linux**.

---

## Features

- Live WebSocket connection to any SVX Reflector instance
- Node table with online/offline status, last-heard time, and talkgroup matrix
- Interactive Leaflet map with repeater and hotspot markers
- Click a marker to see frequency, CTCSS, and sysop info
- Dark / light theme toggle
- Map can be hidden so the node table fills the full window
- **macOS**: active talkers appear as a live ticker in the system menu bar
- **Listen** — live per-talkgroup audio streaming from the SVX reflector (Opus over WebSocket, decoded with WebCodecs)
- Auto-update of talkgroup / callsign info from a configurable Portal URL on launch and every 8 hours
- Built-in update check — title-bar pill appears when a newer GitHub release is published
- Configurable WebSocket URL, app title, talkgroup labels, and callsign info via built-in settings
- Custom frameless window with minimize / maximize / always-on-top controls
- Settings and display preferences persist between sessions

---

## Download

Pre-built binaries are available on the [Releases](../../releases) page.

| Platform | File |
| --- | --- |
| macOS (Apple Silicon, M1/M2/M3/M4) | `SVX-Portal-AppleSilicon.dmg` |
| macOS (Intel) | `SVX-Portal-Intel.dmg` |
| Windows (x64) | `SVX-Portal-Setup-x64.exe` |
| Windows (ARM64) | `SVX-Portal-Setup-arm64.exe` |
| Linux (x64) | `SVX-Portal-x64.AppImage` |
| Linux (ARM64) | `SVX-Portal-arm64.AppImage` |

### Signing status per platform

- **macOS** — signed with a Developer ID certificate and notarized by Apple. Opens cleanly from the DMG; no Gatekeeper prompt.
- **Linux** — `.AppImage` doesn't use OS code signing; runs as-is once you mark it executable (`chmod +x`).
- **Windows** — **not code-signed.** Commercial code-signing certificates require either a hardware token or paid managed-signing service, which doesn't make sense for a free / non-commercial radio utility. You can install and run the app safely, you just need to click past a one-time SmartScreen warning.

### Bypassing Windows SmartScreen

When you double-click the installer for the first time, Windows shows:

> **Windows protected your PC** — Microsoft Defender SmartScreen prevented an unrecognised app from starting.

To run it anyway:

1. Click **More info** (small link, easy to miss).
2. Click **Run anyway**.

You only need to do this **once per installed version**. After the app is installed, launching it from the Start menu doesn't trigger the warning again. Your antivirus may also flag it briefly — that's the same root cause (no publisher signature) and not an actual malware detection.

---

## Running from source

```bash
# Prerequisites: Node.js 18+
git clone https://github.com/Guru-RF/SvxPortalApp.git
cd SvxPortalApp
npm install
npm start
```

---

## Building

```bash
npm run build:mac    # macOS .dmg (arm64 + x64)
npm run build:win    # Windows .exe (x64)
npm run build:linux  # Linux .AppImage (x64 + arm64)
```

Output lands in a `dist/` folder.

---

## Configuration

All app configuration lives behind the **gear icon ⚙ in the title bar of the app window**. Click it to open the Settings panel.

| Setting | Description |
| --- | --- |
| WebSocket URL | The `wss://` address of your SVX Reflector |
| App Title | Title shown in the window and menu bar |
| Listen Stream | The `wss://` address of the live audio stream (default `wss://swl.be.svx.link/`) |
| Portal URL | The `https://` Portal that hosts `/talkgroups.json` and `/callsigns.json` (default `https://portal.be.svx.link/`) |
| Auto-update | If enabled, TG & Callsign info refresh from the Portal on launch and every 8 hours |
| TG Info JSON | Map of talkgroup IDs to human-readable names (used when auto-update is off) |
| Callsign Info JSON | Map of callsigns to frequency / CTCSS / sysop info shown in tooltips |

The **Restore Defaults** button reloads the factory values bundled with this build.  
Display preferences (theme, map, filters, window size) are saved automatically.

---

## Listening to talkgroups

When the **Listen Stream** is reachable, a "Listen" bar appears below the title bar with one button per talkgroup the stream is currently distributing. Click a button to start listening; click again to stop. Only one talkgroup plays at a time — switching is a single click. Audio is Opus over WebSocket, decoded locally with the browser's WebCodecs API and played through a small jitter buffer.

---

## Credits

Concept by [ON8ST](https://www.qrz.com/db/ON8ST),  
coded by [ON6URE](https://www.qrz.com/db/ON6URE),  
built on top of [svxreflector](https://github.com/sm0svx/svxlink) by [SM0SVX](https://www.qrz.com/db/SM0SVX).

Hosted by [rf.guru](https://rf.guru).

---

## License

MIT — see [LICENSE](LICENSE).
