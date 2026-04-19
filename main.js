const { app, BrowserWindow, ipcMain, Tray, nativeImage, shell } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;
let tray = null;
let preferredBleName = "";

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

// Defaults sourced from env.yaml — update that file and ship a new build to push changes.
// Users can override via the Settings panel; their saved values take precedence.
const DEFAULT_SETTINGS = {
  wsUrl: "wss://reflector.be.svx.link/",
  title: "SVX Reflector \u2022 Live",
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

function loadSettings() {
  try {
    const p = getSettingsPath();
    if (fs.existsSync(p)) {
      const saved = JSON.parse(fs.readFileSync(p, "utf-8"));
      // Treat empty objects as "not set" so defaults are used instead
      if (!saved.talkgroupInfo || !Object.keys(saved.talkgroupInfo).length)
        delete saved.talkgroupInfo;
      if (!saved.callsignInfo || !Object.keys(saved.callsignInfo).length)
        delete saved.callsignInfo;
      return { ...DEFAULT_SETTINGS, ...saved };
    }
  } catch (_) {}
  return { ...DEFAULT_SETTINGS };
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

  // Auto-open DevTools when running unpackaged (i.e. `npm start`)
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // Trigger BLE auto-reconnect after page loads, with synthetic user gesture
  // so navigator.bluetooth.requestDevice() is allowed without a click.
  mainWindow.webContents.once("did-finish-load", () => {
    mainWindow.webContents.executeJavaScript(
      "typeof window.bleAutoReconnectOnStartup === 'function' && window.bleAutoReconnectOnStartup();",
      true /* userGesture */
    ).catch(() => {});
  });

  // Route external links (target="_blank" and window.open) to the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Web Bluetooth device picker — prefer the previously-paired device by name,
  // otherwise take the first device whose service UUID matched our filter.
  // If no device appears in 15s we time the scan out so the renderer doesn't
  // hang forever when the hotspot is off.
  let bleScanTimeout = null;
  let bleCurrentCallback = null;
  const cancelBleScan = (cb) => {
    if (bleScanTimeout) { clearTimeout(bleScanTimeout); bleScanTimeout = null; }
    bleCurrentCallback = null;
    try { cb(""); } catch (_) {}
  };
  mainWindow.webContents.on("select-bluetooth-device", (event, devices, callback) => {
    event.preventDefault();
    bleCurrentCallback = callback;
    const preferred = preferredBleName;
    const exact = preferred && devices.find((d) => d.deviceName === preferred);
    if (exact) {
      if (bleScanTimeout) { clearTimeout(bleScanTimeout); bleScanTimeout = null; }
      bleCurrentCallback = null;
      return callback(exact.deviceId);
    }
    if (devices.length > 0 && !preferred) {
      if (bleScanTimeout) { clearTimeout(bleScanTimeout); bleScanTimeout = null; }
      bleCurrentCallback = null;
      return callback(devices[0].deviceId);
    }
    // No match yet — set a timeout if not already set
    if (!bleScanTimeout) {
      bleScanTimeout = setTimeout(() => {
        bleScanTimeout = null;
        const cb = bleCurrentCallback;
        bleCurrentCallback = null;
        if (cb) try { cb(""); } catch (_) {}
      }, 15000);
    }
  });

  // Persist Bluetooth device permissions so navigator.bluetooth.getDevices()
  // can auto-reconnect on next app launch without re-scanning.
  mainWindow.webContents.session.setDevicePermissionHandler((details) => {
    if (details.deviceType === "bluetooth") return true;
    return false;
  });
  mainWindow.webContents.session.setPermissionCheckHandler((_wc, permission) => {
    if (permission === "bluetooth" || permission === "bluetooth-devices") return true;
    return false;
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
    // 32px PNG displayed as 16pt on Retina (scaleFactor 2)
    const icon = nativeImage.createFromBuffer(iconData, {
      width: 16, height: 16, scaleFactor: 2.0,
    });
    tray = new Tray(icon);
    tray.setToolTip("SVX Portal");
  } catch (e) {
    console.warn("Tray creation failed:", e.message);
  }
}

app.whenReady().then(() => {
  // Use our icon in the dock during development (electron-builder handles the
  // packaged app, but `npm start` shows the default Electron icon otherwise).
  if (process.platform === "darwin" && app.dock) {
    try {
      const dockIcon = nativeImage.createFromPath(
        path.join(__dirname, "build", "icon-512.png")
      );
      if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
    } catch (_) {}
  }
  createWindow();
  createTray();
});

app.on("window-all-closed", () => {
  app.quit();
});

// Settings
ipcMain.handle("settings:load", () => loadSettings());
ipcMain.handle("settings:defaults", () => ({ ...DEFAULT_SETTINGS }));

ipcMain.handle("settings:save", (_event, settings) => {
  const current = loadSettings();
  saveSettings({ ...current, ...settings });
});

// Window controls
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

// BLE preferred device name (set by renderer from localStorage)
ipcMain.on("ble:preferred-name", (_event, name) => {
  preferredBleName = name || "";
});

// Tray ticker — macOS: menu bar text, Windows: balloon notifications
let prevTalkerText = "";
ipcMain.on("tray:talkers", (_event, text) => {
  if (!tray) return;

  if (process.platform === "darwin") {
    tray.setTitle(text || "");
  }
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
