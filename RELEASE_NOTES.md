# Release Notes

## v1.0.3

- **Fix**: Footer links (QRZ, rf.guru) now open in the system browser instead of trying to open a new Electron window.

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
