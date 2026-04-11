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
- Configurable WebSocket URL, app title, talkgroup labels, and callsign info via built-in settings
- Custom frameless window with minimize / maximize / always-on-top controls
- Settings and display preferences persist between sessions

---

## Download

Pre-built binaries are available on the [Releases](../../releases) page.

| Platform | Format |
| --- | --- |
| macOS (Apple Silicon + Intel) | `.dmg` (universal) |
| Windows | `.exe` (NSIS installer, x64) |
| Linux | `.AppImage` (x64 + ARM64) |

> **Note — unsigned builds:**  
> The current releases are **not code-signed**. macOS will show a Gatekeeper warning the first time you open the app. To bypass it: right-click the `.app` → **Open** → confirm in the dialog. Windows SmartScreen may also warn you. Code signing will be added in a future release.

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

Open the **Settings** panel (gear icon ⚙ in the title bar).

| Setting | Description |
| --- | --- |
| WebSocket URL | The `wss://` address of your SVX Reflector |
| App Title | Title shown in the window and menu bar |
| TG Info JSON | Map of talkgroup IDs to human-readable names |
| Callsign Info JSON | Map of callsigns to frequency / CTCSS / sysop info shown in tooltips |

The **Restore Defaults** button reloads the factory values bundled with this build.  
Display preferences (theme, map, filters, window size) are saved automatically.

---

## Credits

Concept by [ON8ST](https://www.qrz.com/db/ON8ST),  
coded by [ON6URE](https://www.qrz.com/db/ON6URE),  
built on top of [svxreflector](https://github.com/sm0svx/svxlink) by [SM0SVX](https://www.qrz.com/db/SM0SVX).

Hosted by [rf.guru](https://rf.guru).

---

## License

MIT — see [LICENSE](LICENSE).
