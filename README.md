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
- **HotSpot remote control over Bluetooth LE** — send DTMF, run system commands (SVXLink start/stop, 4G enable/disable, reboot, poweroff), and view the live 4G signal meter directly from the app
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

All app configuration lives behind the **gear icon ⚙ in the title bar of the app window**. Click it to open the Settings panel.

| Setting | Description |
| --- | --- |
| WebSocket URL | The `wss://` address of your SVX Reflector |
| App Title | Title shown in the window and menu bar |
| TG Info JSON | Map of talkgroup IDs to human-readable names |
| Callsign Info JSON | Map of callsigns to frequency / CTCSS / sysop info shown in tooltips |

The **Restore Defaults** button reloads the factory values bundled with this build.  
Display preferences (theme, map, filters, window size) are saved automatically.

---

## Connecting to a HotSpot over Bluetooth

> **You do not need to pair the HotSpot in your OS Bluetooth settings.** All discovery and connection happens inside the app.

What you do need:

1. **Bluetooth turned on** on the computer running the app.
2. The HotSpot powered on and within range.

To connect:

1. Click the **gear icon ⚙ in the title bar** to open Settings.
2. In the **Bluetooth (HotSpot)** section, click **Scan & Connect**.
3. If a single HotSpot is found and remembered from a previous session, it auto-connects. Otherwise, a picker lists all discovered HotSpots — click the one you want.
4. The first time you connect to a device, it's saved automatically. The next app launch reconnects in the background; no clicks needed.
5. Use **Forget** in Settings to clear the remembered device.

When connected, a control bar appears below the title bar with a DTMF field, quick buttons (TG, Status, IP, Parrot), a 4G signal meter, and a Commands dropdown for system-level actions on the HotSpot.

---

## Credits

Concept by [ON8ST](https://www.qrz.com/db/ON8ST),  
coded by [ON6URE](https://www.qrz.com/db/ON6URE),  
built on top of [svxreflector](https://github.com/sm0svx/svxlink) by [SM0SVX](https://www.qrz.com/db/SM0SVX).

Hosted by [rf.guru](https://rf.guru).

---

## License

MIT — see [LICENSE](LICENSE).
