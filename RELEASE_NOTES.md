# Release Notes

## v1.0.12

- **macOS**: DMGs are now clearly labelled — `…-AppleSilicon.dmg` for M1/M2/M3/M4 Macs and `…-Intel.dmg` for older Intel Macs. No more guessing which file to grab.

---

## v1.0.11

- **New**: Bluetooth device picker — when more than one HotSpot is in range (or you've never paired before), a modal lists all discovered devices live so you can choose. Saved devices still auto-reconnect with no prompt.
- **New**: "Forget" button in Settings → Bluetooth — clears the remembered HotSpot so the next scan shows the picker again.

---

## v1.0.10

- **New**: 4G/LTE signal meter in the DTMF bar — subscribes to the hotspot's BLE feed characteristic and shows live RSSI as a 4-bar gauge. Tooltip reveals the exact dBm reading and label (excellent / good / fair / weak / very poor). Hidden gracefully when the hotspot has no modem or doesn't expose the feed characteristic.

---

## v1.0.9

- **New app icon** — fresh 1024×1024 artwork replaces the old design, with a clean multi-resolution `.icns` for macOS and a matching menu-bar tray icon.
- Source icon (`/icon.png`) lives in the repo root so future tweaks are a single-file update.

---

## v1.0.8

- **macOS**: App icon now uses a proper multi-resolution `.icns` file — no more gray frame in the dock / Finder.
- **Windows**: Native dropdown popups now render correctly in dark mode without needing to hover out first (meta color-scheme + explicit dark option styling).

---

## v1.0.7

- **Fix**: Native dropdown menus (Commands, Window) now follow the app theme on Windows — dark background with light text in dark mode, instead of unreadable white-on-white.

---

## v1.0.6

- **macOS builds are now signed and notarized with a Developer ID certificate** — no more Gatekeeper warnings, no more right-click-Open workaround.
- Bluetooth / network usage descriptions added to Info.plist so macOS shows clear prompts when the app accesses BLE or the network.

Windows and Linux builds remain unsigned in this release.

---

## v1.0.5

- **New**: Bluetooth LE integration with SVX HotSpot devices
  - Scan & connect from the Settings panel
  - Auto-reconnect on startup to the last-paired HotSpot (no clicks needed)
  - One-click reconnect button in the title bar when disconnected
  - Callsign input in settings; the online/offline status of your callsign appears live in the DTMF bar
- **New**: DTMF bar (visible only when BLE-connected)
  - Type any DTMF sequence (0–9, A–D, *, #) and Send
  - Quick buttons: **TG** (`9*#`), **Status** (`*#`), **IP** (`D911#`), **Parrot** (`D1#`)
  - Click any TG column header in the node table to send `91<tg>#` directly
  - HotSpot commands dropdown: SVXLink start/stop/restart, 4G enable/disable, Reboot, Power Off
- **Robustness**: keepalive pings the GATT link every 8s to prevent macOS from parking idle connections; automatic exponential-backoff reconnect when the link drops; watchdog revives the loop if it silently stalls
- **Fix**: App icon now appears correctly in the macOS dock when running from source

---

## v1.0.4

- **macOS**: Tray icon now renders with proper transparency in the menu bar
- **Windows**: System tray with balloon notifications when talkers change
- **Fix**: Footer links (QRZ, rf.guru) now open in the system browser instead of trying to open a new Electron window

---

## v1.0.0 — Initial Release

First public release of the SVX Portal desktop app.

### What's included

- Live SVX Reflector monitoring via WebSocket
- Node table with online/offline status, last-heard time, and talkgroup matrix
- Interactive map (Leaflet) with repeater and hotspot markers — click any marker for frequency, CTCSS, and sysop details
- Dark / light theme, persisted between sessions
- Map can be hidden so the node table fills the full window
- **macOS**: active talkers shown as a live ticker in the system menu bar
- Built-in Settings window (gear icon) for WebSocket URL, app title, talkgroup labels, and callsign info
- Pre-loaded with Belgian SVX Reflector defaults (wss://reflector.be.svx.link/)
- Display preferences (theme, filters, window select) persist automatically
- Custom frameless window with minimize / maximize / always-on-top / close controls
- Builds for macOS (Apple Silicon + Intel), Windows (x64), and Linux (x64 + ARM64)

---

### Important — unsigned builds

> The binaries in this release are **not code-signed or notarized**.

**macOS:**  
Gatekeeper will block the app on first launch.  
To open it: **right-click** the `.app` → **Open** → click **Open** in the confirmation dialog.  
You only need to do this once; subsequent launches work normally.

**Windows:**  
Windows SmartScreen may show a "Windows protected your PC" warning.  
Click **More info** → **Run anyway** to proceed.

Code signing and notarization will be added in a future release once distribution infrastructure is in place.

---

### Known limitations

- No auto-update — download a new build from the Releases page to get updates
- Code signing pending (see above)
