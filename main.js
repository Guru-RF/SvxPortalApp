const { app, BrowserWindow, ipcMain, Tray, nativeImage, shell } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;
let tray = null;

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

// Build-time secrets — values that need to ship in the build but must not
// land in the public repo. `secrets.json` is gitignored; see
// `secrets.example.json` for the expected shape. The file is read once at
// startup and folded into DEFAULT_SETTINGS so the renderer sees the values
// like any other config field.
function loadBuildSecrets() {
  try {
    const p = path.join(__dirname, "secrets.json");
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  } catch (_) {}
  return {};
}
const BUILD_SECRETS = loadBuildSecrets();

// Single user-facing reflector base. The actual reflector / portal / stream
// URLs are derived from this — see deriveUrls() below.
//   "be.svx.link"             → standard DNS SRV style, prepend prefixes
//   "reflector.be.svx.link"   → leading "reflector." stripped, then same
//   wss:// or https:// prefix → stripped before derivation
const DEFAULT_SETTINGS = {
  reflector: "be.svx.link",
  title: "SVX Reflector • Live",
  streamToken: BUILD_SECRETS.streamToken || "",
  autoUpdateInfo: true,
  talkgroupInfo: {
    "4": "4m Repeaters",
    "6": "6m Repeaters",
    "8": "70cm Repeaters",
    "23": "23cm Repeaters",
    "50": "Talkgroup 0",
    "51": "Talkgroup 1",
    "52": "Talkgroup 2",
    "53": "Talkgroup 3",
    "54": "Talkgroup 4",
    "55": "Talkgroup 5",
    "1745": "ON0ORA Local off-net",
    "8400": "145.400 Simplex Club Oostende",
    "8401": "145.7125 VHF Repeater Oostende",
    "9000": "145.7 VHF Repeater Gent",
  },
  callsignInfo: {
    "ON0ORA": "TX:438.8000 RX:431.2000\nCTCSS-OUT: 131.8\nCTCSS-IN: 131.8 Network\nCTCSS-IN: 254.1 Local\nSysop: ON4IT, ON6URE",
    "ON0BRK": "TX:438.9125 RX:431.3125\nCTCSS-OUT: 79.7\nCTCSS-IN: 79.7\nSysop: ON1DGR",
    "ON0APS": "TX:438.3625 RX:430.7625\nCTCSS-OUT: 79.7\nCTCSS-IN: 79.7\nSysop: ON1DGR",
    "ON0CK": "TX:439.2375 RX:431.6375\nCTCSS-OUT: 79.7\nCTCSS-IN: 79.7\nSysop: ",
    "ON0DEN": "TX:439.0375 RX:431.4375\nCTCSS-OUT: 79.7\nCTCSS-IN: 79.7\nSysop: ON1DGR",
    "ON0GRC": "TX:439.2500 RX:431.4375\nCTCSS-OUT: 79.7\nCTCSS-IN: 79.7\nSysop: ",
    "ON0HOE": "TX:439.4250 RX:431.8250\nCTCSS-OUT: 131.8\nCTCSS-IN: 131.8\nSysop: ",
    "ON0LB": "TX:438.9000 RX:431.3000\nCTCSS-OUT: 131.8\nCTCSS-IN: 131.8\nSysop: ",
    "ON0LEE": "TX:438.6750 RX:431.0750\nCTCSS-OUT: 79.7\nCTCSS-IN: 79.7\nSysop: ",
    "ON0ODR": "TX:439.1500 RX:431.5500\nCTCSS-OUT: 79.7\nCTCSS-IN: 79.7\nSysop: ON5OB",
    "ON0ONZ": "TX:438.7250 RX:431.1250\nCTCSS-OUT: 79.7\nCTCSS-IN: 79.7\nSysop: ",
    "ON0OSB": "TX:439.4375 RX:431.8375\nCTCSS-OUT: 79.7\nCTCSS-IN: 79.7\nSysop: ",
    "ON0UHF": "TX:439.3375 RX:431.7375\nCTCSS-OUT: 79.7\nCTCSS-IN: 79.7\nSysop: ON6UHF",
    "ON0OST": "TX:439.3000 RX:431.7000\nCTCSS-OUT: 79.7\nCTCSS-IN: 79.7\nSysop: ON4AIM",
    "ON0VDS-23": "TX:1298.700 RX:1270.7000\nSysop: ON6VDS, ON6BH",
    "ON0VDS-4": "TX:70.3625 RX:70.1625\nCTCSS-OUT: 79.7\nCTCSS-IN: 79.7\nSysop: ON6VDS, ON6BH",
    "ON0VDS-6": "TX:51.8900 RX:51.2900\nCTCSS-OUT: 79.7\nCTCSS-IN: 79.7\nSysop: ON6VDS, ON6BH",
    "ON0OST-V": "TX:145.71250 RX:145.11250\nCTCSS-OUT: 79.7\nCTCSS-IN: 79.7\nSysop: ON4AIM",
    "ON0OST-S": "TX/RX:145.4000\nClub Frequency",
  },
  alwaysOnTop: false,
};

// Strip schemes, trailing slash, and leading "reflector." → base domain.
function normalizeReflectorBase(input) {
  return String(input || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^wss?:\/\//i, "")
    .replace(/\/+$/, "")
    .replace(/^reflector\./i, "");
}

// Build the three runtime URLs from a base domain like "be.svx.link".
function deriveUrls(reflector) {
  const base = normalizeReflectorBase(reflector);
  if (!base) return null;
  return {
    wsUrl: `wss://reflector.${base}/`,
    streamUrl: `wss://swl.${base}/`,
    portalUrl: `https://portal.${base}/`,
  };
}

// Try to back-fill reflector from a legacy saved wsUrl ("wss://reflector.X/").
function reflectorFromWsUrl(wsUrl) {
  const m = String(wsUrl || "").match(/^wss?:\/\/(?:reflector\.)?([^\/]+)/i);
  return m ? m[1] : "";
}

function loadSettings() {
  try {
    const p = getSettingsPath();
    let saved = {};
    if (fs.existsSync(p)) {
      saved = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (!saved.talkgroupInfo || !Object.keys(saved.talkgroupInfo).length)
        delete saved.talkgroupInfo;
      if (!saved.callsignInfo || !Object.keys(saved.callsignInfo).length)
        delete saved.callsignInfo;
    }
    const merged = { ...DEFAULT_SETTINGS, ...saved };
    // Migrate older settings: if reflector is missing but wsUrl is present,
    // recover the base from it.
    if (!merged.reflector && merged.wsUrl) {
      merged.reflector = reflectorFromWsUrl(merged.wsUrl);
    }
    // Always derive the three URLs at runtime so the renderer never has to.
    const derived = deriveUrls(merged.reflector);
    if (derived) Object.assign(merged, derived);
    return merged;
  } catch (_) {}
  return { ...DEFAULT_SETTINGS, ...(deriveUrls(DEFAULT_SETTINGS.reflector) || {}) };
}

function saveSettings(settings) {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

function createWindow() {
  const settings = loadSettings();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 400,
    minHeight: 500,
    alwaysOnTop: settings.alwaysOnTop || false,
    frame: false,
    transparent: false,
    backgroundColor: "#0b1220",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.setMenuBarVisibility(false);

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // External links open in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.on("maximize", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window:maximized", true);
    }
  });

  mainWindow.on("unmaximize", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window:maximized", false);
    }
  });
}

function createTray() {
  if (process.platform === "linux") return;
  try {
    const iconPath = path.join(__dirname, "build", "tray-icon.png");
    const iconData = fs.readFileSync(iconPath);
    const icon = nativeImage.createFromBuffer(iconData, {
      width: 16, height: 16, scaleFactor: 2.0,
    });
    tray = new Tray(icon);
    tray.setToolTip("SVX Portal");
  } catch (e) {
    console.warn("Tray creation failed:", e.message);
  }
}

// ── GitHub update check ───────────────────────────────────────────────────────
// Poll GitHub's "latest release" endpoint at startup and once a day after.
// Renderer shows a red pill in the title bar; clicking opens the releases page.
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_RELEASES_URL =
  "https://api.github.com/repos/Guru-RF/SvxPortalApp/releases/latest";
const UPDATE_LANDING_URL =
  "https://github.com/Guru-RF/SvxPortalApp/releases/latest";

function isNewerVersion(remote, local) {
  const pa = String(remote).split(".").map((n) => Number(n) || 0);
  const pb = String(local).split(".").map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const a = pa[i] || 0;
    const b = pb[i] || 0;
    if (a !== b) return a > b;
  }
  return false;
}

async function checkForUpdates() {
  try {
    const res = await fetch(UPDATE_RELEASES_URL, {
      headers: {
        "User-Agent": "SVX-Portal-Desktop",
        "Accept": "application/vnd.github+json",
      },
    });
    if (!res.ok) return;
    const json = await res.json();
    const latest = String(json.tag_name || "").replace(/^v/, "").trim();
    if (!latest) return;
    if (!isNewerVersion(latest, app.getVersion())) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:available", {
        version: latest,
        url: UPDATE_LANDING_URL,
      });
    }
  } catch (_) {}
}

function startUpdateChecking() {
  setTimeout(checkForUpdates, 5000);
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
}

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    try {
      const dockIcon = nativeImage.createFromPath(
        path.join(__dirname, "build", "icon.png")
      );
      if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
    } catch (_) {}
  }
  createWindow();
  createTray();
  startUpdateChecking();
});

app.on("window-all-closed", () => {
  app.quit();
});

// ── Settings IPC ──────────────────────────────────────────────────────────────
ipcMain.handle("settings:load", () => loadSettings());
ipcMain.handle("settings:defaults", () => {
  const out = { ...DEFAULT_SETTINGS };
  const derived = deriveUrls(out.reflector);
  if (derived) Object.assign(out, derived);
  return out;
});
ipcMain.handle("settings:save", (_event, settings) => {
  const current = loadSettings();
  saveSettings({ ...current, ...settings });
});

// ── Window controls ───────────────────────────────────────────────────────────
ipcMain.handle("window:toggleOnTop", () => {
  const next = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(next);
  const s = loadSettings();
  s.alwaysOnTop = next;
  saveSettings(s);
  return next;
});
ipcMain.handle("window:getOnTop", () => mainWindow.isAlwaysOnTop());
ipcMain.handle("window:isMaximized", () => mainWindow.isMaximized());
ipcMain.on("window:minimize", () => mainWindow.minimize());
ipcMain.on("window:maximize", () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on("window:close", () => mainWindow.close());

// ── Update pill IPC ───────────────────────────────────────────────────────────
ipcMain.on("update:open", () => {
  shell.openExternal(UPDATE_LANDING_URL).catch(() => {});
});

// ── Tray ticker ───────────────────────────────────────────────────────────────
// macOS: live menu-bar text. Windows: balloon notifications.
let prevTalkerText = "";
ipcMain.on("tray:talkers", (_event, text) => {
  if (!tray) return;
  if (process.platform === "darwin") tray.setTitle(text || "");
  tray.setToolTip(text ? `Talking: ${text}` : "SVX Portal");
  if (process.platform === "win32" && text && text !== prevTalkerText) {
    tray.displayBalloon({
      title: "SVX Portal",
      content: `Talking: ${text}`,
      iconType: "info",
    });
  }
  prevTalkerText = text || "";
});
