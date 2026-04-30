const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Settings
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (s) => ipcRenderer.invoke("settings:save", s),
  getDefaults: () => ipcRenderer.invoke("settings:defaults"),
  updateTrayTalkers: (text) => ipcRenderer.send("tray:talkers", text),
  setPreferredBleName: (name) => ipcRenderer.send("ble:preferred-name", name),

  // BLE device picker
  onBleDevices: (cb) => ipcRenderer.on("ble:devices", (_e, list) => cb(list)),
  onBleClosePicker: (cb) => ipcRenderer.on("ble:close-picker", () => cb()),
  pickBleDevice: (deviceId) => ipcRenderer.send("ble:pick-device", deviceId),
  cancelBlePick: () => ipcRenderer.send("ble:cancel-pick"),

  // Window controls
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),

  toggleOnTop: () => ipcRenderer.invoke("window:toggleOnTop"),
  getOnTop: () => ipcRenderer.invoke("window:getOnTop"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),

  onMaximizeChange: (cb) =>
    ipcRenderer.on("window:maximized", (_e, v) => cb(v)),
});
