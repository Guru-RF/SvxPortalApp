"use strict";

/**
 * SVX Portal App — Renderer
 * Adapted from SvxReflectorPortal/public/app.js for Electron desktop.
 *
 * Key differences vs. the web portal:
 *  - Config loaded via window.api.loadSettings() (IPC) instead of /config.json
 *  - No auto-hide header (desktop window has persistent header)
 *  - Custom title bar controls (minimize, maximize, close, always-on-top, settings)
 *  - Settings panel lets user change WS URL / title / TG info / callsign info in-app
 */

// Dynamic — replaced from state.tgInfo keys whenever talkgroup info loads
// (applyConfig + refreshPortalInfo). Initial seed is kept only so the table
// renders something sane before the first config arrives.
let TG_LIST = [
  4, 6, 8, 23, 40, 50, 51, 52, 53, 54, 55, 58, 60, 1745, 1785, 2300, 2990,
  8400, 8401, 9000,
];

function rebuildTgList() {
  const tgs = Object.keys(state.tgInfo || {})
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (tgs.length) TG_LIST = tgs;
}

// Belgium bounds (default)
const BE_SW = [49.48, 2.54];
const BE_NE = [51.55, 6.41];

const THEME_KEY = "svx-app-theme";
const MAP_HOME_KEY = "svx-app-map-home-v1";
const UI_PREFS_KEY = "svx-app-ui-prefs-v1";

// Overlap / spiderfy tuning
const OVERLAP_DECIMALS = 6;
const SPIDER_R1_PX = 56;
const SPIDER_R2_PX = 96;
const SPIDER_R1_CAP = 10;
const SPIDER_R2_CAP = 22;
const SPIDER_SEGMENTS = 72;

// ── UI prefs persistence ──────────────────────────────────────────────────────

function loadUiPrefs() {
  try {
    return JSON.parse(localStorage.getItem(UI_PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveUiPrefs(prefs) {
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

function restoreUiPrefs() {
  const p = loadUiPrefs();
  if (showRepeatersEl && typeof p.showRepeaters === "boolean")
    showRepeatersEl.checked = p.showRepeaters;
  if (showHotspotsEl && typeof p.showHotspots === "boolean")
    showHotspotsEl.checked = p.showHotspots;
  if (activeOnlyEl && typeof p.activeOnly === "boolean")
    activeOnlyEl.checked = p.activeOnly;
  if (windowSelectEl && p.windowSec != null) {
    const v = String(p.windowSec);
    if (Array.from(windowSelectEl.options).some((o) => o.value === v))
      windowSelectEl.value = v;
  }
}

function persistUiPrefs() {
  saveUiPrefs({
    showRepeaters: isChecked(showRepeatersEl, true),
    showHotspots: isChecked(showHotspotsEl, true),
    activeOnly: isChecked(activeOnlyEl, true),
    windowSec: selectNumber(windowSelectEl, 3600),
  });
}

// ── DOM refs ─────────────────────────────────────────────────────────────────

const titleEl = document.getElementById("title");
const statusEl = document.getElementById("status");
const tbody = document.getElementById("tbody");
const theadRow = document.getElementById("theadRow");

// Tooltip
let tooltipEl = document.getElementById("tooltip");
if (!tooltipEl) {
  tooltipEl = document.createElement("div");
  tooltipEl.id = "tooltip";
  tooltipEl.className = "hidden";
  tooltipEl.setAttribute("aria-hidden", "true");
  document.body.appendChild(tooltipEl);
}

// Controls
const showRepeatersEl = document.getElementById("showRepeaters");
const showHotspotsEl = document.getElementById("showHotspots");
const activeOnlyEl = document.getElementById("activeOnly");
const windowSelectEl = document.getElementById("windowSelect");
const themeToggleEl = document.getElementById("themeToggle");
const mapToggleEl = document.getElementById("mapToggle");

// Title bar + settings
const titlebarStatusEl = document.getElementById("titlebar-status");
const settingsPanelEl = document.getElementById("settings-overlay");
const inputWsUrl = document.getElementById("input-ws-url");
const inputAppTitle = document.getElementById("input-app-title");
const inputTgInfo = document.getElementById("input-tg-info");
const inputCsInfo = document.getElementById("input-cs-info");
const inputPortalUrl = document.getElementById("input-portal-url");
const inputAutoUpdateInfo = document.getElementById("input-auto-update-info");

// ── Helpers ───────────────────────────────────────────────────────────────────

function isChecked(el, fallback) {
  return el ? !!el.checked : !!fallback;
}
function selectNumber(el, fallback) {
  if (!el) return fallback;
  const n = Number(el.value);
  return Number.isFinite(n) ? n : fallback;
}

// ── Application state ─────────────────────────────────────────────────────────

const state = {
  cfg: null,
  nodes: new Map(),
  lastHeard: new Map(),
  prevTalker: new Map(),

  homeView: null,
  mapAutoMove: false,

  wsOk: false,
  activeWs: null,

  tgInfo: {},
  csInfo: {},

  hoverTg: null,
  hoverCs: null,

  map: null,
  lightTiles: null,
  darkTiles: null,
  markerLayer: null,
  repMarkers: new Map(),
  hsMarkers: new Map(),
  beBounds: null,
  focusMode: "home",
  focusKey: "",

  overlapIndex: new Map(),
  spiderKey: "",
  spiderMarkers: [],
  spiderRings: [],
};

// ── Utility functions ──────────────────────────────────────────────────────────

function isRepeater(callsign) {
  return String(callsign || "")
    .toUpperCase()
    .startsWith("ON0");
}

function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.trim().replace(/O/g, "0").replace(/,/g, "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function msAgoLabel(deltaMs) {
  const s = Math.floor(deltaMs / 1000);
  if (!Number.isFinite(s) || s < 0) return "\u2014";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

function formatLocation(raw) {
  let s = (raw ?? "").toString().trim();
  if (!s) return "";
  if (/^[A-Za-z]{2}\d{2}[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  s = s.toLowerCase().replace(/\s+/g, " ").trim();
  let out = "";
  let capNext = true;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (capNext && /[a-z\u00C0-\u017F]/.test(ch)) out += ch.toUpperCase();
    else out += ch;
    capNext = ch === " " || ch === "-";
  }
  return out;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Tooltip helpers ───────────────────────────────────────────────────────────

function asTipText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    const title = (v.title ?? "").toString().trim();
    const text = (v.text ?? v.desc ?? "").toString().trim();
    if (title && text) return `${title}\n${text}`;
    if (title) return title;
    if (text) return text;
    return JSON.stringify(v);
  }
  return String(v).trim();
}

function tgTip(tg) {
  const txt = asTipText(state.tgInfo[String(tg)]);
  return txt ? `TG ${tg}\n${txt}` : "";
}

function csTip(cs) {
  const key = String(cs || "").toUpperCase();
  const txt = asTipText(state.csInfo[key]);
  return txt ? `${key}\n${txt}` : "";
}

function showTip(text, x, y) {
  if (!text) return;
  tooltipEl.textContent = text;
  tooltipEl.classList.remove("hidden");
  moveTip(x, y);
}

function moveTip(x, y) {
  if (tooltipEl.classList.contains("hidden")) return;
  const pad = 12;
  const margin = 8;
  let left = x + pad;
  let top = y + pad;
  const rect = tooltipEl.getBoundingClientRect();
  if (left + rect.width > window.innerWidth - margin)
    left = x - rect.width - pad;
  if (top + rect.height > window.innerHeight - margin)
    top = y - rect.height - pad;
  left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin));
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

function hideTip() {
  tooltipEl.classList.add("hidden");
  tooltipEl.textContent = "";
}

function initHoverTooltips() {
  if (!theadRow || !tbody) return;

  function showTgFromEvent(e) {
    const th = e.target.closest("th[data-tg]");
    if (!th) {
      state.hoverTg = null;
      hideTip();
      return;
    }
    const tg = th.dataset.tg;
    const txt = tgTip(tg);
    if (!txt) {
      state.hoverTg = null;
      hideTip();
      return;
    }
    state.hoverTg = tg;
    state.hoverCs = null;
    showTip(txt, e.clientX, e.clientY);
  }

  theadRow.addEventListener("mouseover", (e) => showTgFromEvent(e));
  theadRow.addEventListener("mousemove", (e) => {
    if (!tooltipEl.classList.contains("hidden")) moveTip(e.clientX, e.clientY);
    const th = e.target.closest("th[data-tg]");
    const tg = th ? th.dataset.tg : null;
    if (tg && tg !== state.hoverTg) showTgFromEvent(e);
  });
  theadRow.addEventListener("mouseleave", () => {
    state.hoverTg = null;
    hideTip();
  });

  function showCsFromEvent(e) {
    const el = e.target.closest(".csHover[data-cs]");
    if (!el) {
      state.hoverCs = null;
      hideTip();
      return;
    }
    const cs = el.dataset.cs || "";
    const txt = csTip(cs);
    if (!txt) {
      state.hoverCs = null;
      hideTip();
      return;
    }
    state.hoverCs = cs;
    state.hoverTg = null;
    showTip(txt, e.clientX, e.clientY);
  }

  tbody.addEventListener("mouseover", (e) => showCsFromEvent(e));
  tbody.addEventListener("mousemove", (e) => {
    if (!tooltipEl.classList.contains("hidden")) moveTip(e.clientX, e.clientY);
    const el = e.target.closest(".csHover[data-cs]");
    const cs = el ? el.dataset.cs : null;
    if (cs && cs !== state.hoverCs) showCsFromEvent(e);
  });
  tbody.addEventListener("mouseleave", () => {
    state.hoverCs = null;
    hideTip();
  });

  const scrollHost = document.querySelector(".tableFrame");
  if (scrollHost)
    scrollHost.addEventListener("scroll", () => hideTip(), { passive: true });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTip();
  });
}

// ── Theme ──────────────────────────────────────────────────────────────────────

function applyTheme(dark) {
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  if (themeToggleEl) themeToggleEl.checked = dark;

  if (state.map) {
    if (dark) {
      if (state.map.hasLayer(state.lightTiles)) state.map.removeLayer(state.lightTiles);
      if (!state.map.hasLayer(state.darkTiles)) state.darkTiles.addTo(state.map);
    } else {
      if (state.map.hasLayer(state.darkTiles)) state.map.removeLayer(state.darkTiles);
      if (!state.map.hasLayer(state.lightTiles)) state.lightTiles.addTo(state.map);
    }
  }

  try {
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  } catch {}
  renderAll();
}

function initThemeDefaultDark() {
  let dark = true;
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light") dark = false;
    if (stored === "dark") dark = true;
  } catch {}
  applyTheme(dark);
}

if (themeToggleEl)
  themeToggleEl.addEventListener("change", () => applyTheme(themeToggleEl.checked));

// ── Map visibility toggle ─────────────────────────────────────────────────────

const MAP_VISIBLE_KEY = "svx-app-map-visible";

function applyMapVisible(visible) {
  const mapEl = document.getElementById("map");
  const tableFrame = document.querySelector(".tableFrame");
  if (mapEl) mapEl.style.display = visible ? "" : "none";
  if (tableFrame) tableFrame.classList.toggle("map-hidden", !visible);
  if (mapToggleEl) mapToggleEl.checked = visible;
  try { localStorage.setItem(MAP_VISIBLE_KEY, visible ? "1" : "0"); } catch {}
  // Let Leaflet recalculate layout when map is revealed
  if (visible && state.map) setTimeout(() => state.map.invalidateSize(), 50);
}

function initMapVisible() {
  let visible = true;
  try {
    const stored = localStorage.getItem(MAP_VISIBLE_KEY);
    if (stored === "0") visible = false;
  } catch {}
  applyMapVisible(visible);
}

if (mapToggleEl)
  mapToggleEl.addEventListener("change", () => applyMapVisible(mapToggleEl.checked));

// ── Table header ───────────────────────────────────────────────────────────────

function buildTgHeader() {
  if (!theadRow) return;
  Array.from(theadRow.querySelectorAll("th[data-tg]")).forEach((x) => x.remove());
  for (const tg of TG_LIST) {
    const th = document.createElement("th");
    th.className = "tg";
    th.dataset.tg = String(tg);
    th.innerHTML = `<span>${tg}</span>`;
    theadRow.appendChild(th);
  }
}

// ── Map home view persistence ──────────────────────────────────────────────────

function loadMapHome() {
  try {
    const raw = localStorage.getItem(MAP_HOME_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng) || !Number.isFinite(v.zoom))
      return null;
    return { lat: v.lat, lng: v.lng, zoom: v.zoom };
  } catch {
    return null;
  }
}

function saveMapHomeFromMap() {
  if (!state.map) return;
  const c = state.map.getCenter();
  const z = state.map.getZoom();
  const v = { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6), zoom: z };
  state.homeView = v;
  try {
    localStorage.setItem(MAP_HOME_KEY, JSON.stringify(v));
  } catch {}
}

function goHomeView(animated = true) {
  if (!state.map) return;
  const v = state.homeView || loadMapHome();
  state.homeView = v || null;
  state.mapAutoMove = true;
  if (v) state.map.setView([v.lat, v.lng], v.zoom, { animate: animated });
  else state.map.fitBounds(state.beBounds, { padding: [20, 20] });
  state.focusMode = "home";
  state.focusKey = "";
}

function addCenterControl() {
  if (!state.map || typeof L === "undefined") return;

  const CenterControl = L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
      const btn = L.DomUtil.create("a", "leaflet-control-center", container);
      btn.href = "#";
      btn.title = "Center map (reset to default)";
      btn.setAttribute("aria-label", "Center map");
      btn.innerHTML = "&#x2316;";
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      L.DomEvent.on(btn, "click", (e) => {
        L.DomEvent.preventDefault(e);
        try { localStorage.removeItem(MAP_HOME_KEY); } catch {}
        state.homeView = null;
        goHomeView(true);
      });
      return container;
    },
  });

  state.map.addControl(new CenterControl());
}

// ── Overlap / spiderfy ────────────────────────────────────────────────────────

function coordKey(lat, lon) {
  return `${Number(lat).toFixed(OVERLAP_DECIMALS)},${Number(lon).toFixed(OVERLAP_DECIMALS)}`;
}

function ringLatLngs(baseLatLng, radiusPx) {
  const pts = [];
  const center = state.map.latLngToLayerPoint(baseLatLng);
  for (let i = 0; i <= SPIDER_SEGMENTS; i++) {
    const a = (i / SPIDER_SEGMENTS) * Math.PI * 2;
    const pt = L.point(
      center.x + radiusPx * Math.cos(a),
      center.y + radiusPx * Math.sin(a),
    );
    pts.push(state.map.layerPointToLatLng(pt));
  }
  return pts;
}

function unspiderfy() {
  if (!state.map) return;
  for (const m of state.spiderMarkers) {
    if (m && m._svxBaseLatLng) {
      try { m.setLatLng(m._svxBaseLatLng); } catch {}
    }
  }
  for (const r of state.spiderRings) {
    try { state.map.removeLayer(r); } catch {}
  }
  state.spiderMarkers = [];
  state.spiderRings = [];
  state.spiderKey = "";
}

function rebuildOverlapIndex() {
  state.overlapIndex = new Map();
  function addMarker(m) {
    if (!m || !m._svxBaseKey) return;
    const arr = state.overlapIndex.get(m._svxBaseKey) || [];
    arr.push(m);
    state.overlapIndex.set(m._svxBaseKey, arr);
  }
  for (const m of state.repMarkers.values()) addMarker(m);
  for (const m of state.hsMarkers.values()) addMarker(m);
}

function applyOverlapOutline() {
  const ring = cssVar("--overlap-ring", "#E7E2C6");
  const all = [
    ...Array.from(state.repMarkers.values()),
    ...Array.from(state.hsMarkers.values()),
  ];
  for (const m of all) {
    if (!m || typeof m.setStyle !== "function") continue;
    const group = m._svxBaseKey ? state.overlapIndex.get(m._svxBaseKey) : null;
    if (group && group.length > 1) {
      const w = Math.max(Number(m.options?.weight) || 1, 4);
      m.setStyle({ color: ring, weight: w, opacity: 1 });
    }
  }
}

function placeOnRing(markers, baseLatLng, radiusPx, offsetAngle = 0) {
  const center = state.map.latLngToLayerPoint(baseLatLng);
  const n = markers.length;
  if (!n) return;
  for (let i = 0; i < n; i++) {
    const a = offsetAngle + (i / n) * Math.PI * 2;
    const pt = L.point(
      center.x + radiusPx * Math.cos(a),
      center.y + radiusPx * Math.sin(a),
    );
    try { markers[i].setLatLng(state.map.layerPointToLatLng(pt)); } catch {}
  }
}

function spiderfyKey(key) {
  if (!state.map || typeof L === "undefined") return;
  const group = state.overlapIndex.get(key) || [];
  if (group.length <= 1 || state.spiderKey === key) return;

  unspiderfy();

  const sorted = group.slice().sort((a, b) => {
    const at = a?._svxIsTalker ? 1 : 0;
    const bt = b?._svxIsTalker ? 1 : 0;
    if (at !== bt) return bt - at;
    return (a?._svxCallsign || "").localeCompare(b?._svxCallsign || "");
  });

  const base = sorted[0]._svxBaseLatLng;
  if (!base) return;

  const ringColor = cssVar("--spider-ring", cssVar("--border", "#94a3b8"));

  const r1 = L.polyline(ringLatLngs(base, SPIDER_R1_PX), {
    color: ringColor, weight: 2, opacity: 0.55, dashArray: "6 6", interactive: false,
  }).addTo(state.map);

  const r2 = L.polyline(ringLatLngs(base, SPIDER_R2_PX), {
    color: ringColor, weight: 2, opacity: 0.35, dashArray: "2 8", interactive: false,
  }).addTo(state.map);

  state.spiderRings = [r1, r2];

  const ring1 = sorted.slice(0, Math.min(sorted.length, SPIDER_R1_CAP));
  const ring2 = sorted.slice(ring1.length, Math.min(sorted.length, SPIDER_R1_CAP + SPIDER_R2_CAP));
  const rest = sorted.slice(ring1.length + ring2.length);

  placeOnRing(ring1, base, SPIDER_R1_PX, 0);
  placeOnRing(ring2, base, SPIDER_R2_PX, Math.PI / 10);
  if (rest.length) placeOnRing(rest, base, SPIDER_R2_PX + 34, Math.PI / 6);

  state.spiderKey = key;
  state.spiderMarkers = sorted;
  normalizeMarkerZOrder();
}

function bindSpiderfyClick(marker) {
  if (!marker || marker._svxSpiderBound) return;
  marker._svxSpiderBound = true;
  marker.on("click", (ev) => {
    try {
      if (ev?.originalEvent && typeof L !== "undefined")
        L.DomEvent.stopPropagation(ev.originalEvent);
    } catch {}
    const key = marker._svxBaseKey;
    if (!key) return;
    const group = state.overlapIndex.get(key) || [];
    if (group.length > 1 && state.spiderKey !== key) {
      try { marker.closePopup(); } catch {}
      spiderfyKey(key);
    }
  });
}

// ── Map ────────────────────────────────────────────────────────────────────────

function initMap() {
  const mapEl = document.getElementById("map");
  if (!mapEl || typeof L === "undefined") return;

  const map = L.map("map", { worldCopyJump: true, zoomControl: true });
  state.map = map;

  state.lightTiles = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" },
  );

  state.darkTiles = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    { maxZoom: 19, attribution: "&copy; OpenStreetMap, &copy; CARTO", className: "tiles-dark-soft" },
  );

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  (isDark ? state.darkTiles : state.lightTiles).addTo(map);

  state.markerLayer = L.layerGroup().addTo(map);
  state.beBounds = L.latLngBounds([BE_SW, BE_NE]);

  addCenterControl();

  state.homeView = loadMapHome();
  state.mapAutoMove = true;
  if (state.homeView)
    map.setView([state.homeView.lat, state.homeView.lng], state.homeView.zoom, { animate: false });
  else
    map.fitBounds(state.beBounds, { padding: [20, 20] });

  state.focusMode = "home";
  state.focusKey = "";

  map.on("click", () => unspiderfy());
  map.on("zoomstart", () => unspiderfy());
  map.on("movestart", () => unspiderfy());

  map.on("moveend", () => {
    if (state.mapAutoMove) { state.mapAutoMove = false; return; }
    saveMapHomeFromMap();
    if (visibleTalkersOutsideBelgium().length === 0) {
      state.focusMode = "home";
      state.focusKey = "";
    }
  });
}

function coordInBelgium(lat, lon) {
  return lat >= BE_SW[0] && lat <= BE_NE[0] && lon >= BE_SW[1] && lon <= BE_NE[1];
}

function callsignInfoText(callsign) {
  const key = String(callsign || "").toUpperCase();
  return asTipText(state.csInfo ? state.csInfo[key] : null);
}

function popupHtmlForNode(callsign, locationText) {
  const cs = String(callsign || "").toUpperCase();
  const loc = String(locationText || "").trim();
  const info = callsignInfoText(cs);
  const infoBlock = info
    ? `<div style="margin-top:6px;white-space:pre-line;color:var(--muted);">${escapeHtml(info)}</div>`
    : "";
  return `<strong>${escapeHtml(cs)}</strong><br>${escapeHtml(loc)}${infoBlock}`;
}

function upsertMarker(mapKey, callsign, lat, lon, popupHtml) {
  let m = mapKey.get(callsign);
  if (!m) {
    m = L.circleMarker([lat, lon], { radius: 6, weight: 1, opacity: 1, fillOpacity: 0.8 });
    m.addTo(state.markerLayer);
    m.bindPopup(popupHtml, { maxWidth: 460, minWidth: 300, autoPanPadding: [20, 20] });
    mapKey.set(callsign, m);
  } else {
    m.setLatLng([lat, lon]);
    m.setPopupContent(popupHtml);
  }
  return m;
}

function removeMarker(mapKey, callsign) {
  const m = mapKey.get(callsign);
  if (m) { state.markerLayer.removeLayer(m); mapKey.delete(callsign); }
}

function setTalkLabel(marker, callsign, enabled) {
  try {
    if (enabled) {
      const txt = String(callsign || "").toUpperCase();
      if (!txt) return;
      if (marker.getTooltip?.()) marker.setTooltipContent(txt);
      else marker.bindTooltip(txt, { permanent: true, direction: "top", offset: [0, -10], className: "talkLabel", opacity: 0.96 });
    } else {
      if (marker.getTooltip?.()) marker.unbindTooltip();
    }
  } catch {}
}

function setRepeaterStyle(marker, node) {
  const accent = cssVar("--accent", "#A52A2A");
  const ok = cssVar("--ok", "#35c48d");
  const muted = "rgba(148,163,184,.55)";
  let color = muted, radius = 5, fillOpacity = 0.3, weight = 1;
  if (node.online) { color = ok; fillOpacity = 0.55; radius = 6; }
  if (node.isTalker) { color = accent; fillOpacity = 1.0; radius = 8; weight = 4; }
  marker.setStyle({ color, fillColor: color, radius, fillOpacity, weight, opacity: 1 });
  setTalkLabel(marker, node.callsign, !!node.isTalker);
}

function setHotspotStyle(marker, node) {
  const accent = cssVar("--accent", "#A52A2A");
  const hs = cssVar("--hotspot", "#FFA502");
  let color = hs, radius = 6, fillOpacity = node.online ? 0.65 : 0.25, weight = 1;
  if (node.isTalker) { color = accent; radius = 8; fillOpacity = 1.0; weight = 4; }
  marker.setStyle({ color, fillColor: color, radius, fillOpacity, weight, opacity: 1 });
  setTalkLabel(marker, node.callsign, !!node.isTalker);
}

function visibleTalkersOutsideBelgium() {
  const showRepeaters = isChecked(showRepeatersEl, true);
  const showHotspots = isChecked(showHotspotsEl, true);
  const activeOnly = isChecked(activeOnlyEl, true);
  const out = [];
  for (const n of state.nodes.values()) {
    if (!n.isTalker || n.lat == null || n.lon == null) continue;
    const rep = isRepeater(n.callsign);
    if (rep && !showRepeaters) continue;
    if (!rep && !showHotspots && !n.isTalker) continue;
    if (activeOnly && !n.online) continue;
    if (!coordInBelgium(n.lat, n.lon)) out.push(n);
  }
  return out;
}

function updateMapFocus() {
  if (!state.map) return;
  const outside = visibleTalkersOutsideBelgium();
  const key = outside.map((n) => n.callsign).sort().join(",");
  if (outside.length > 0) {
    if (state.focusMode !== "out" || state.focusKey !== key) {
      const b = L.latLngBounds([BE_SW, BE_NE]);
      outside.forEach((n) => b.extend([n.lat, n.lon]));
      state.mapAutoMove = true;
      state.map.fitBounds(b, { padding: [30, 30] });
      state.focusMode = "out";
      state.focusKey = key;
    }
    return;
  }
  if (state.focusMode !== "home") goHomeView();
}

function updateMapMarkers() {
  if (!state.map) return;
  unspiderfy();

  const showRepeaters = isChecked(showRepeatersEl, true);
  const showHotspots = isChecked(showHotspotsEl, true);
  const activeOnly = isChecked(activeOnlyEl, true);

  for (const n of state.nodes.values()) {
    const lat = toNumber(n.lat);
    const lon = toNumber(n.lon);
    if (lat == null || lon == null) continue;

    const rep = isRepeater(n.callsign);
    const loc = formatLocation(n.location || "");

    if (rep) {
      if (!showRepeaters || (activeOnly && !n.online)) {
        removeMarker(state.repMarkers, n.callsign);
        continue;
      }
      const popup = popupHtmlForNode(n.callsign, loc);
      const m = upsertMarker(state.repMarkers, n.callsign, lat, lon, popup);
      m._svxCallsign = String(n.callsign || "").toUpperCase();
      m._svxIsTalker = !!n.isTalker;
      m._svxBaseLatLng = L.latLng(lat, lon);
      m._svxBaseKey = coordKey(lat, lon);
      bindSpiderfyClick(m);
      setRepeaterStyle(m, { ...n, lat, lon });
    } else {
      if (!showHotspots && !n.isTalker) {
        removeMarker(state.hsMarkers, n.callsign);
        continue;
      }
      if (showHotspots && activeOnly && !n.online && !n.isTalker) {
        removeMarker(state.hsMarkers, n.callsign);
        continue;
      }
      const popup = popupHtmlForNode(n.callsign, loc);
      const m = upsertMarker(state.hsMarkers, n.callsign, lat, lon, popup);
      m._svxCallsign = String(n.callsign || "").toUpperCase();
      m._svxIsTalker = !!n.isTalker;
      m._svxBaseLatLng = L.latLng(lat, lon);
      m._svxBaseKey = coordKey(lat, lon);
      bindSpiderfyClick(m);
      setHotspotStyle(m, { ...n, lat, lon });
    }
  }

  for (const cs of Array.from(state.repMarkers.keys()))
    if (!state.nodes.has(cs)) removeMarker(state.repMarkers, cs);
  for (const cs of Array.from(state.hsMarkers.keys()))
    if (!state.nodes.has(cs)) removeMarker(state.hsMarkers, cs);

  rebuildOverlapIndex();
  applyOverlapOutline();
  normalizeMarkerZOrder();
}

function normalizeMarkerZOrder() {
  for (const [cs, m] of state.hsMarkers.entries()) {
    const n = state.nodes.get(cs);
    if (!n?.isTalker && m.bringToBack) m.bringToBack();
  }
  for (const [, m] of state.repMarkers.entries())
    if (m?.bringToFront) m.bringToFront();
  for (const n of state.nodes.values()) {
    if (!n.isTalker) continue;
    const m = isRepeater(n.callsign)
      ? state.repMarkers.get(n.callsign)
      : state.hsMarkers.get(n.callsign);
    if (m?.bringToFront) m.bringToFront();
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderStatus() {
  const online = [...state.nodes.values()].filter((n) => n.online).length;
  const offline = [...state.nodes.values()].filter((n) => !n.online).length;
  const talking = [...state.nodes.values()].filter((n) => n.isTalker).length;
  const dot = "\u2022";
  const ell = "\u2026";

  const text = state.wsOk
    ? `Connected ${dot} Online: ${online} ${dot} Offline: ${offline} ${dot} Talking: ${talking}`
    : `Disconnected ${dot} Reconnecting${ell}`;

  const cls = state.wsOk ? "ok" : "bad";

  if (statusEl) {
    statusEl.textContent = text;
    statusEl.className = "conn " + cls;
  }
  if (titlebarStatusEl) {
    titlebarStatusEl.textContent = text;
    titlebarStatusEl.className = cls;
  }

  // macOS menu bar ticker — show active talkers, clear when none
  const talkerText = [...state.nodes.values()]
    .filter((n) => n.isTalker)
    .map((n) => n.callsign)
    .join(" \u2022 ");
  window.api.updateTrayTalkers(talkerText);

  // Update the BLE bar callsign dot (online/offline of user's configured callsign)
  refreshCallsignDot();
}

function chooseTalkTg(node) {
  if (!node.isTalker) return 0;
  // Prefer the active tg even when it's not in TG_LIST — the row renderer
  // collapses unknown TGs into a "TG <num>" balloon.
  const tg = Number(node.tg || 0);
  if (tg) return tg;
  if (Array.isArray(node.monitoredTGs) && node.monitoredTGs.length) {
    const first = Number(node.monitoredTGs[0]);
    if (Number.isFinite(first) && first > 0) return first;
  }
  return 0;
}

function shouldShowInTable(node, nowMs) {
  const showRepeaters = isChecked(showRepeatersEl, true);
  const showHotspots = isChecked(showHotspotsEl, true);
  const activeOnly = isChecked(activeOnlyEl, true);
  const rep = isRepeater(node.callsign);

  if (rep && !showRepeaters) return false;
  if (!rep && !showHotspots && !node.isTalker) return false;
  if (activeOnly && !node.online) return false;

  const windowMs = selectNumber(windowSelectEl, 3600) * 1000;
  if (node.isTalker) return true;

  const last = state.lastHeard.get(node.callsign) || 0;
  if (!activeOnly && !node.online && !last) return true;
  if (!last) return false;
  return nowMs - last <= windowMs;
}

function renderTable() {
  if (!tbody) return;
  const now = Date.now();
  const rows = [];
  for (const n of state.nodes.values()) {
    if (!shouldShowInTable(n, now)) continue;
    const last = state.lastHeard.get(n.callsign) || 0;
    rows.push({ n, last, ago: last ? now - last : Infinity });
  }

  rows.sort((a, b) => {
    if (!!a.n.isTalker !== !!b.n.isTalker) return a.n.isTalker ? -1 : 1;
    if (!!a.n.online !== !!b.n.online) return a.n.online ? -1 : 1;
    if (a.ago !== b.ago) return a.ago - b.ago;
    return a.n.callsign.localeCompare(b.n.callsign);
  });

  const html = rows
    .map(({ n, last }) => {
      const dot = n.online
        ? `<span class="dotOnline"></span>`
        : `<span class="dotOffline"></span>`;
      const heard = n.isTalker
        ? `<span class="timeNow">Now</span>`
        : last
          ? msAgoLabel(Date.now() - last)
          : "\u2014";

      const monitored = Array.isArray(n.monitoredTGs) ? n.monitoredTGs : [];
      const talkTg = chooseTalkTg(n);
      const talkTgInList = !!talkTg && TG_LIST.includes(talkTg);

      let tgCells;
      if (n.isTalker && talkTg && !talkTgInList) {
        // Talker is on a TG that isn't in our configured list — collapse the
        // matrix into a single balloon cell.
        tgCells = `<td class="tg tgOther" colspan="${TG_LIST.length}"><span class="tgTalkDot"></span><span class="tgOtherLabel">TG ${escapeHtml(String(talkTg))}</span></td>`;
      } else {
        tgCells = TG_LIST.map((tg) => {
          if (n.isTalker && talkTg === tg)
            return `<td class="tg"><span class="tgTalkDot"></span></td>`;
          if (monitored.includes(tg))
            return `<td class="tg"><span class="tgCheck">&#10003;</span></td>`;
          return `<td class="tg"></td>`;
        }).join("");
      }

      const loc = formatLocation(n.location || "");
      const mDotText = n.isTalker && talkTg ? String(talkTg) : "";
      const mDotState = n.online ? "online" : "offline";
      const mDotTalk = n.isTalker ? " talking" : "";
      const mDotHtml = `<span class="mDot ${mDotState}${mDotTalk}">${escapeHtml(mDotText)}</span>`;

      return `
      <tr class="${n.isTalker ? "talkingRow" : ""}">
        <td class="narrow center">${dot}</td>
        <td>
          <span class="csHover" data-cs="${escapeHtml(n.callsign)}">
            ${mDotHtml}<strong>${escapeHtml(n.callsign)}</strong>
          </span>
        </td>
        <td>${escapeHtml(loc)}</td>
        <td class="center">${heard}</td>
        ${tgCells}
      </tr>`;
    })
    .join("");

  tbody.innerHTML =
    html ||
    `<tr><td colspan="${4 + TG_LIST.length}" style="padding:14px;color:var(--muted)">No nodes in this window.</td></tr>`;
}

function renderAll() {
  renderStatus();
  renderTable();
  updateMapMarkers();
  updateMapFocus();
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

function ensureNodeFromSession(sess) {
  const cs = String(sess?.callsign || "").toUpperCase();
  if (!cs || state.nodes.has(cs)) return;

  let location = "", lat = null, lon = null, monitoredTGs = [], tg = 0;
  const hint = sess.node && typeof sess.node === "object" ? sess.node : null;
  if (hint) {
    location = (hint.nodeLocation || "").toString();
    tg = Number(hint.tg || 0) || 0;
    if (Array.isArray(hint.monitoredTGs)) {
      monitoredTGs = hint.monitoredTGs.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    }
    if (hint.qth && typeof hint.qth === "object") {
      lat = toNumber(hint.qth.lat);
      lon = toNumber(hint.qth.long);
    }
  }

  state.nodes.set(cs, { callsign: cs, online: false, isTalker: false, tg, monitoredTGs, location, lat, lon });
  state.prevTalker.set(cs, false);
}

function updateLastHeardFromSession(sess) {
  if (!sess) return;
  ensureNodeFromSession(sess);
  const cs = String(sess.callsign || "").toUpperCase();
  if (!cs) return;
  const ts = sess.end_ms || sess.start_ms;
  if (!ts) return;
  const old = state.lastHeard.get(cs) || 0;
  if (ts > old) state.lastHeard.set(cs, ts);
}

function applyNodeUpsert(node) {
  if (!node || typeof node !== "object") return;
  const cs = String(node.callsign || "").toUpperCase();
  if (!cs) return;

  const prev = state.nodes.get(cs) || { callsign: cs };
  const monitored = Array.isArray(node.monitoredTGs)
    ? node.monitoredTGs.map(Number).filter(Number.isFinite).sort((a, b) => a - b)
    : Array.isArray(prev.monitoredTGs) ? prev.monitoredTGs : [];

  const merged = {
    ...prev, ...node, callsign: cs,
    online: !!node.online, isTalker: !!node.isTalker,
    tg: Number(node.tg || 0) || 0, monitoredTGs: monitored,
    lat: toNumber(node.lat ?? prev.lat), lon: toNumber(node.lon ?? prev.lon),
    location: (node.location ?? prev.location ?? "").toString(),
  };

  state.nodes.set(cs, merged);

  const wasTalker = !!state.prevTalker.get(cs);
  if ((!wasTalker && merged.isTalker) || (wasTalker && !merged.isTalker)) {
    const t = Date.now();
    const old = state.lastHeard.get(cs) || 0;
    if (t > old) state.lastHeard.set(cs, t);
  }
  state.prevTalker.set(cs, merged.isTalker);
}

function disconnectWs() {
  if (state.activeWs) {
    try { state.activeWs.onclose = null; state.activeWs.close(); } catch {}
    state.activeWs = null;
  }
}

function connectWs() {
  const wsUrl = state.cfg?.wsUrl;
  if (!wsUrl) return;

  disconnectWs();

  let ws;
  try {
    ws = new WebSocket(wsUrl);
  } catch {
    state.wsOk = false;
    renderAll();
    setTimeout(connectWs, 3000);
    return;
  }

  state.activeWs = ws;

  ws.onopen = () => { state.wsOk = true; renderAll(); };
  ws.onclose = () => {
    if (state.activeWs !== ws) return; // superseded
    state.wsOk = false;
    renderAll();
    setTimeout(connectWs, 3000);
  };
  ws.onerror = () => { state.wsOk = false; renderAll(); };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type === "snapshot") {
      state.nodes.clear();
      state.prevTalker.clear();
      for (const n of Array.isArray(msg.nodes) ? msg.nodes : []) applyNodeUpsert(n);
      for (const s of Array.isArray(msg.sessions) ? msg.sessions : []) updateLastHeardFromSession(s);
      for (const s of Array.isArray(msg.active) ? msg.active : []) updateLastHeardFromSession(s);
      renderAll();
      return;
    }
    if (msg.type === "node_upsert" && msg.node) { applyNodeUpsert(msg.node); renderAll(); return; }
    if ((msg.type === "talk_start" || msg.type === "talk_stop") && msg.session) {
      updateLastHeardFromSession(msg.session); renderAll(); return;
    }
  };
}

// ── Config normalizers ────────────────────────────────────────────────────────

function normalizeTgInfo(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const key = String(k).trim();
    if (key) out[key] = v;
  }
  return out;
}

function normalizeCsInfo(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const key = String(k).trim().toUpperCase();
    if (key) out[key] = v;
  }
  return out;
}

function applyConfig(cfg) {
  state.cfg = cfg;
  if (titleEl && cfg.title) titleEl.textContent = cfg.title;
  state.tgInfo = normalizeTgInfo(cfg.talkgroupInfo || {});
  state.csInfo = normalizeCsInfo(cfg.callsignInfo || {});
  rebuildTgList();
  // Kick off a portal fetch in the background — overrides the in-memory
  // tgInfo / csInfo when it returns, leaving settings.json untouched.
  if (cfg.autoUpdateInfo !== false && cfg.portalUrl) {
    refreshPortalInfo();
  }
}

// ── Portal auto-update (talkgroups.json + callsigns.json) ─────────────────

const PORTAL_REFRESH_MS = 8 * 60 * 60 * 1000; // 8 hours
let portalRefreshTimer = null;

async function fetchPortalInfo(portalUrl) {
  if (!portalUrl) return null;
  const base = portalUrl.replace(/\/+$/, "");
  try {
    const [tgRes, csRes] = await Promise.all([
      fetch(`${base}/talkgroups.json`, { cache: "no-store" }),
      fetch(`${base}/callsigns.json`, { cache: "no-store" }),
    ]);
    if (!tgRes.ok) throw new Error(`talkgroups.json HTTP ${tgRes.status}`);
    if (!csRes.ok) throw new Error(`callsigns.json HTTP ${csRes.status}`);
    const tg = await tgRes.json();
    const cs = await csRes.json();
    return { tg, cs };
  } catch (err) {
    console.warn("Portal info fetch failed:", err.message);
    return null;
  }
}

async function refreshPortalInfo() {
  const cfg = state.cfg;
  if (!cfg?.autoUpdateInfo || !cfg.portalUrl) return;
  const data = await fetchPortalInfo(cfg.portalUrl);
  if (!data) return;
  state.tgInfo = normalizeTgInfo(data.tg || {});
  state.csInfo = normalizeCsInfo(data.cs || {});
  rebuildTgList();
  buildTgHeader();
  renderAll();
}

function startPortalAutoUpdate() {
  if (portalRefreshTimer) clearInterval(portalRefreshTimer);
  portalRefreshTimer = setInterval(refreshPortalInfo, PORTAL_REFRESH_MS);
}

// ── Title bar controls ────────────────────────────────────────────────────────

function initTitleBar() {
  document.getElementById("btn-minimize")?.addEventListener("click", () => window.api.minimize());
  document.getElementById("btn-maximize")?.addEventListener("click", () => window.api.maximize());
  document.getElementById("btn-close")?.addEventListener("click", () => window.api.close());

  const btnOnTop = document.getElementById("btn-ontop");
  window.api.getOnTop().then((v) => {
    if (v && btnOnTop) btnOnTop.classList.add("active");
  });
  btnOnTop?.addEventListener("click", async () => {
    const v = await window.api.toggleOnTop();
    if (v) btnOnTop.classList.add("active");
    else btnOnTop.classList.remove("active");
  });

  // Update maximize icon when window state changes
  window.api.onMaximizeChange((isMax) => {
    const btn = document.getElementById("btn-maximize");
    if (btn) btn.innerHTML = isMax ? "&#10064;" : "&#9633;";
  });
  window.api.isMaximized().then((isMax) => {
    const btn = document.getElementById("btn-maximize");
    if (btn) btn.innerHTML = isMax ? "&#10064;" : "&#9633;";
  });
}

// ── Settings panel ────────────────────────────────────────────────────────────

function openSettings() {
  if (!settingsPanelEl) return;

  const cfg = state.cfg || {};
  if (inputWsUrl) inputWsUrl.value = cfg.wsUrl || "";
  if (inputAppTitle) inputAppTitle.value = cfg.title || "";
  if (inputPortalUrl) inputPortalUrl.value = cfg.portalUrl || "";
  if (inputAutoUpdateInfo) inputAutoUpdateInfo.checked = cfg.autoUpdateInfo !== false;
  if (inputTgInfo) {
    const tg = cfg.talkgroupInfo;
    inputTgInfo.value = tg && Object.keys(tg).length ? JSON.stringify(tg, null, 2) : "";
  }
  if (inputCsInfo) {
    const cs = cfg.callsignInfo;
    inputCsInfo.value = cs && Object.keys(cs).length ? JSON.stringify(cs, null, 2) : "";
  }
  updateInfoEditableState();

  settingsPanelEl.classList.remove("hidden");
  inputWsUrl?.focus();
}

// Grey out the TG / Callsign textareas when auto-update is on — the portal
// will overwrite the in-memory values, so editing them in settings has no
// effect until auto-update is turned off.
function updateInfoEditableState() {
  const enabled = !inputAutoUpdateInfo?.checked;
  if (inputTgInfo) inputTgInfo.disabled = !enabled;
  if (inputCsInfo) inputCsInfo.disabled = !enabled;
}

function closeSettings() {
  settingsPanelEl?.classList.add("hidden");
}

function initSettings() {
  document.getElementById("btn-settings")?.addEventListener("click", () => {
    if (settingsPanelEl?.classList.contains("hidden")) openSettings();
    else closeSettings();
  });

  // Close when clicking the backdrop (outside the modal card)
  settingsPanelEl?.addEventListener("click", (e) => {
    if (e.target === settingsPanelEl) closeSettings();
  });

  document.getElementById("btn-cancel-settings")?.addEventListener("click", closeSettings);

  document.getElementById("btn-restore-defaults")?.addEventListener("click", async () => {
    const defaults = await window.api.getDefaults();
    if (inputWsUrl) inputWsUrl.value = defaults.wsUrl || "";
    if (inputAppTitle) inputAppTitle.value = defaults.title || "";
    if (inputPortalUrl) inputPortalUrl.value = defaults.portalUrl || "";
    if (inputAutoUpdateInfo) inputAutoUpdateInfo.checked = defaults.autoUpdateInfo !== false;
    if (inputTgInfo) inputTgInfo.value = defaults.talkgroupInfo && Object.keys(defaults.talkgroupInfo).length
      ? JSON.stringify(defaults.talkgroupInfo, null, 2) : "";
    if (inputCsInfo) inputCsInfo.value = defaults.callsignInfo && Object.keys(defaults.callsignInfo).length
      ? JSON.stringify(defaults.callsignInfo, null, 2) : "";
    updateInfoEditableState();
  });

  // Live-update the grey-out state when the user toggles the checkbox
  inputAutoUpdateInfo?.addEventListener("change", updateInfoEditableState);

  document.getElementById("btn-save-settings")?.addEventListener("click", async () => {
    const wsUrl = (inputWsUrl?.value || "").trim() || "wss://reflector.be.svx.link/";
    const title = (inputAppTitle?.value || "").trim() || "SVX Portal";

    let talkgroupInfo = {};
    let callsignInfo = {};

    try {
      const raw = (inputTgInfo?.value || "").trim();
      if (raw) talkgroupInfo = JSON.parse(raw);
    } catch {
      alert("Talkgroup Info is not valid JSON.");
      return;
    }
    try {
      const raw = (inputCsInfo?.value || "").trim();
      if (raw) callsignInfo = JSON.parse(raw);
    } catch {
      alert("Callsign Info is not valid JSON.");
      return;
    }

    const portalUrl = (inputPortalUrl?.value || "").trim() || "https://portal.be.svx.link/";
    const autoUpdateInfo = !!inputAutoUpdateInfo?.checked;

    const newCfg = { wsUrl, title, portalUrl, autoUpdateInfo, talkgroupInfo, callsignInfo };
    await window.api.saveSettings(newCfg);

    applyConfig(newCfg);
    closeSettings();

    // Reconnect WebSocket with new URL
    state.nodes.clear();
    state.prevTalker.clear();
    state.lastHeard.clear();
    state.wsOk = false;
    renderAll();
    connectWs();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

// ── BLE HotSpot DTMF / Command client ────────────────────────────────────────

const BLE_SVC_UUID = "6b1d6a10-c50f-4d86-a7f3-7f2a3a1b2c3d";
const BLE_WRITE_UUID = "6b1d6a11-c50f-4d86-a7f3-7f2a3a1b2c3d";
const BLE_STATUS_UUID = "6b1d6a12-c50f-4d86-a7f3-7f2a3a1b2c3d";
const BLE_CMD_UUID = "6b1d6a13-c50f-4d86-a7f3-7f2a3a1b2c3d";
const BLE_FEED_UUID = "6b1d6a14-c50f-4d86-a7f3-7f2a3a1b2c3d";
const CALLSIGN_KEY = "svx-app-callsign";
const BLE_LAST_DEVICE_KEY = "svx-app-ble-last-device";

function getSavedDeviceName() {
  try { return localStorage.getItem(BLE_LAST_DEVICE_KEY) || ""; }
  catch { return ""; }
}
function saveDeviceName(name) {
  if (!name) return;
  try { localStorage.setItem(BLE_LAST_DEVICE_KEY, name); } catch {}
  try { window.api.setPreferredBleName?.(name); } catch {}
}

const ble = {
  device: null,
  writeChar: null,
  statusChar: null,
  cmdChar: null,
  feedChar: null,
  userDisconnected: false,
  reconnectTimer: null,
  reconnectAttempt: 0,
  keepaliveTimer: null,
};

function getUserCallsign() {
  try { return (localStorage.getItem(CALLSIGN_KEY) || "").toUpperCase().trim(); }
  catch { return ""; }
}
function setUserCallsign(cs) {
  try { localStorage.setItem(CALLSIGN_KEY, cs.toUpperCase().trim()); } catch {}
}

function refreshCallsignDot() {
  const dotEl = document.getElementById("dtmf-callsign-dot");
  const csEl = document.getElementById("dtmf-callsign");
  const cs = getUserCallsign();
  if (csEl) csEl.textContent = cs || "(no callsign set)";
  if (!dotEl) return;
  if (!cs) { dotEl.className = ""; return; }
  const node = state.nodes.get(cs);
  dotEl.className = node?.online ? "online" : "offline";
}

function setBleStatus(text, cls) {
  const el = document.getElementById("ble-status");
  if (el) {
    // When idle / disconnected, hint which device we'll reconnect to
    if (!cls && text === "Not connected") {
      const saved = getSavedDeviceName();
      el.textContent = saved ? `Not connected (last: ${saved})` : "Not connected";
    } else {
      el.textContent = text;
    }
    el.className = cls || "";
  }
  const connected = cls === "connected";

  // Title bar quick-reconnect button: show only when disconnected + we have a saved device
  const quick = document.getElementById("btn-ble-quickconnect");
  if (quick) {
    const saved = getSavedDeviceName();
    quick.style.display = !connected && saved ? "" : "none";
    quick.title = saved ? `Reconnect to ${saved}` : "Reconnect";
  }

  // DTMF bar: only visible when connected
  const bar = document.getElementById("dtmf-bar");
  if (bar) bar.style.display = connected ? "" : "none";

  // Connect/Disconnect/Forget + command row toggles in settings
  const connectBtn = document.getElementById("btn-ble-connect");
  const disconnectBtn = document.getElementById("btn-ble-disconnect");
  const forgetBtn = document.getElementById("btn-ble-forget");
  const cmdRow = document.getElementById("ble-cmd-row");
  if (connectBtn) connectBtn.style.display = connected ? "none" : "";
  if (disconnectBtn) disconnectBtn.style.display = connected ? "" : "none";
  if (forgetBtn) forgetBtn.style.display = !connected && getSavedDeviceName() ? "" : "none";
  if (cmdRow) cmdRow.style.display = connected ? "" : "none";

  if (connected) refreshCallsignDot();

  // TG headers become clickable-to-send when BLE is connected
  document.querySelectorAll("th.tg[data-tg]").forEach((th) => {
    th.classList.toggle("ble-clickable", connected);
  });
}

// 4G/LTE signal meter — fed by the BLE feed characteristic.
// Buckets per Analog-HotSPOT-SVXLink/BLE.md (modem RSSI, not LTE RSRP):
//   ≥ −70   excellent (4 bars)
//   −85..−70 good      (3 bars)
//   −100..−85 fair     (2 bars)
//   −110..−100 weak    (1 bar)
//   <−110   very poor  (1 bar, red tint)
function updateSignalMeter(sg) {
  const meter = document.getElementById("signal-meter");
  if (!meter) return;
  if (sg === "" || sg == null) {
    meter.style.display = "none";
    return;
  }
  const dbm = Number(sg);
  if (!Number.isFinite(dbm)) {
    meter.style.display = "none";
    return;
  }
  let level, label;
  if (dbm >= -70) { level = 4; label = "excellent"; }
  else if (dbm >= -85) { level = 3; label = "good"; }
  else if (dbm >= -100) { level = 2; label = "fair"; }
  else if (dbm >= -110) { level = 1; label = "weak"; }
  else { level = 1; label = "very poor"; }
  meter.style.display = "";
  meter.dataset.level = String(level);
  meter.classList.toggle("very-poor", dbm < -110);
  meter.title = `4G signal: ${dbm} dBm (${label})`;
}

function setDtmfResponse(text, cls) {
  const el = document.getElementById("dtmf-response");
  if (!el) return;
  el.textContent = text || "";
  el.className = cls || "";
}

// Build characteristics + subscriptions for an already-connected device.
async function bleSetupCharacteristics(device) {
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  const service = await server.getPrimaryService(BLE_SVC_UUID);
  const writeChar = await service.getCharacteristic(BLE_WRITE_UUID);
  const statusChar = await service.getCharacteristic(BLE_STATUS_UUID);

  // Optional characteristics — older hotspots may not expose them
  let cmdChar = null;
  try { cmdChar = await service.getCharacteristic(BLE_CMD_UUID); } catch (_) {}
  let feedChar = null;
  try { feedChar = await service.getCharacteristic(BLE_FEED_UUID); } catch (_) {}

  await statusChar.startNotifications();
  statusChar.addEventListener("characteristicvaluechanged", (e) => {
    const text = new TextDecoder().decode(e.target.value);
    const isErr = text.startsWith("err");
    setDtmfResponse(text, isErr ? "bad" : "ok");
  });

  if (feedChar) {
    await feedChar.startNotifications();
    feedChar.addEventListener("characteristicvaluechanged", (e) => {
      const text = new TextDecoder().decode(e.target.value);
      try {
        const data = JSON.parse(text);
        updateSignalMeter(data.sg);
      } catch (_) {
        // Malformed payload — ignore
      }
    });
  } else {
    // No feed support → hide the meter
    updateSignalMeter("");
  }

  ble.device = device;
  ble.writeChar = writeChar;
  ble.statusChar = statusChar;
  ble.cmdChar = cmdChar;
  ble.feedChar = feedChar;
}

function bleClearReconnect() {
  if (ble.reconnectTimer) {
    clearTimeout(ble.reconnectTimer);
    ble.reconnectTimer = null;
  }
  ble.reconnectAttempt = 0;
  ble.reconnecting = false;
}

function stopKeepalive() {
  if (ble.keepaliveTimer) {
    clearInterval(ble.keepaliveTimer);
    ble.keepaliveTimer = null;
  }
}

// Keepalive: every 8s read the status char's CCCD descriptor.
// This is a real ATT Read Request (not cached browser metadata) — it puts
// bytes on the BLE link, preventing macOS CoreBluetooth from parking the
// connection due to inactivity (~15s idle timeout). The server doesn't
// execute anything — reading a CCCD is purely protocol housekeeping.
function startKeepalive() {
  stopKeepalive();
  ble.keepaliveTimer = setInterval(async () => {
    const ch = ble.statusChar;
    const dev = ble.device;
    if (!dev?.gatt?.connected || !ch) return;
    try {
      const cccd = await ch.getDescriptor(
        "00002902-0000-1000-8000-00805f9b34fb"
      );
      await cccd.readValue();
    } catch (_) {
      // Connection broke — gattserverdisconnected will trigger the reconnect loop.
    }
  }, 8000);
}

function scheduleReconnect(delayMs) {
  if (ble.userDisconnected || !ble.device) return;
  if (ble.reconnectTimer) clearTimeout(ble.reconnectTimer);
  ble.reconnectTimer = setTimeout(bleTryReconnect, delayMs);
}

async function bleTryReconnect() {
  ble.reconnectTimer = null;
  if (ble.userDisconnected || !ble.device) return;
  if (ble.reconnecting) return;

  ble.reconnecting = true;
  ble.reconnectAttempt += 1;
  const n = ble.reconnectAttempt;
  setBleStatus("Reconnecting\u2026", "connecting");
  try {
    await bleSetupCharacteristics(ble.device);
    ble.reconnecting = false;
    ble.reconnectAttempt = 0;
    if (ble.device.name) saveDeviceName(ble.device.name);
    setBleStatus(ble.device.name || "Connected", "connected");
    startKeepalive();
  } catch (_) {
    ble.reconnecting = false;
    // Exponential backoff, capped at 15s. Keep retrying until the user
    // explicitly disconnects or the hotspot comes back.
    const delay = Math.min(15000, 1000 * Math.pow(1.6, n - 1));
    scheduleReconnect(delay);
  }
}

// Watchdog: if we think we should be connected but aren't and no reconnect
// is scheduled/running, revive the loop. Guards against silent state corruption.
setInterval(() => {
  if (ble.userDisconnected || !ble.device) return;
  const connected = !!ble.device.gatt?.connected && !!ble.writeChar;
  const busy = ble.reconnectTimer || ble.reconnecting;
  if (!connected && !busy) scheduleReconnect(500);
}, 15000);

async function bleConnect() {
  if (!navigator.bluetooth) {
    setBleStatus("Web Bluetooth not available", "error");
    return;
  }

  // Fully tear down any previous state (background auto-reconnect may be running)
  bleClearReconnect();
  if (ble.device) {
    try { if (ble.device.gatt.connected) ble.device.gatt.disconnect(); } catch (_) {}
    ble.device = null;
  }
  ble.writeChar = null;
  ble.statusChar = null;
  ble.cmdChar = null;
  ble.userDisconnected = false;

  try {
    setBleStatus("Scanning…", "connecting");
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE_SVC_UUID] }],
    });

    setBleStatus(`Connecting to ${device.name || "device"}…`, "connecting");
    device.addEventListener("gattserverdisconnected", () => {
      stopKeepalive();
      ble.writeChar = null;
      ble.statusChar = null;
      ble.cmdChar = null;
      ble.feedChar = null;
      updateSignalMeter("");
      if (ble.userDisconnected) {
        ble.device = null;
        setBleStatus("Not connected", "");
      } else {
        // Unexpected drop — keep device ref and retry in background
        setBleStatus("Connection lost, retrying…", "connecting");
        scheduleReconnect(1000);
      }
    });

    await bleSetupCharacteristics(device);
    if (device.name) saveDeviceName(device.name);
    setBleStatus(device.name || "Connected", "connected");
    startKeepalive();
  } catch (err) {
    console.error("BLE connect failed:", err);
    // Cancellation/timeout is not an error state — leave UI ready for retry
    const msg = err.message || "Connect failed";
    const cancelled = /cancel/i.test(msg) || err.name === "NotFoundError";
    setBleStatus(cancelled ? "Not connected" : msg, cancelled ? "" : "error");
  }
}

// Try silently reconnecting to a previously-paired HotSpot on app startup.
// Uses navigator.bluetooth.getDevices(), which returns devices that have
// previously been granted permission (requires the permission handler in main.js).
// Called from main.js on startup with synthetic user gesture so requestDevice()
// is allowed without a click. Only runs if a device was previously paired.
async function bleAutoReconnectOnStartup() {
  if (!getSavedDeviceName()) return;
  await bleConnect();
}
window.bleAutoReconnectOnStartup = bleAutoReconnectOnStartup;

async function bleDisconnect() {
  ble.userDisconnected = true;
  bleClearReconnect();
  stopKeepalive();
  try {
    if (ble.device && ble.device.gatt.connected) ble.device.gatt.disconnect();
  } catch (_) {}
  ble.device = null;
  ble.writeChar = null;
  ble.statusChar = null;
  ble.cmdChar = null;
  ble.feedChar = null;
  updateSignalMeter("");
  setBleStatus("Not connected", "");
}

async function bleSendDTMF(text) {
  if (!ble.writeChar) return;
  const trimmed = (text || "").trim();
  if (!trimmed) return;
  if (!/^[0-9A-Da-d*#]+$/.test(trimmed)) {
    setDtmfResponse("Invalid DTMF chars", "bad");
    return;
  }
  try {
    const bytes = new TextEncoder().encode(trimmed);
    await ble.writeChar.writeValueWithoutResponse(bytes);
    setDtmfResponse(`→ ${trimmed}`, "");
  } catch (err) {
    console.error("DTMF send failed:", err);
    setDtmfResponse(err.message || "Send failed", "bad");
  }
}

async function bleSendCommand(cmd) {
  if (!ble.cmdChar) {
    setDtmfResponse("Command channel not available", "bad");
    return;
  }
  try {
    const bytes = new TextEncoder().encode(cmd);
    await ble.cmdChar.writeValue(bytes);
    setDtmfResponse(`→ ${cmd}`, "");
  } catch (err) {
    console.error("Command send failed:", err);
    setDtmfResponse(err.message || "Command failed", "bad");
  }
}

// ── BLE device picker (driven from main.js select-bluetooth-device) ─────────

function showBlePicker(devices) {
  const overlay = document.getElementById("ble-picker-overlay");
  const list = document.getElementById("ble-picker-list");
  if (!overlay || !list) return;
  overlay.classList.remove("hidden");
  if (!devices || !devices.length) {
    list.innerHTML = '<span class="muted">Scanning…</span>';
    return;
  }
  list.innerHTML = "";
  for (const d of devices) {
    const btn = document.createElement("button");
    btn.className = "ble-picker-item";
    btn.innerHTML = `<span><strong>${escapeHtml(d.name)}</strong></span><span class="muted">${escapeHtml(d.id.slice(0, 8))}…</span>`;
    btn.addEventListener("click", () => {
      window.api.pickBleDevice(d.id);
      hideBlePicker();
    });
    list.appendChild(btn);
  }
}

function hideBlePicker() {
  document.getElementById("ble-picker-overlay")?.classList.add("hidden");
}

function bleForgetDevice() {
  if (!confirm("Forget the saved HotSpot? You'll need to scan and pick it again next time.")) return;
  try { localStorage.removeItem(BLE_LAST_DEVICE_KEY); } catch {}
  try { window.api.setPreferredBleName?.(""); } catch {}
  bleDisconnect();
}

function initBLE() {
  document.getElementById("btn-ble-connect")?.addEventListener("click", bleConnect);
  document.getElementById("btn-ble-disconnect")?.addEventListener("click", bleDisconnect);
  document.getElementById("btn-ble-quickconnect")?.addEventListener("click", bleConnect);
  document.getElementById("btn-ble-forget")?.addEventListener("click", bleForgetDevice);

  // Picker modal: cancel buttons + backdrop click
  const cancel = () => { window.api.cancelBlePick?.(); hideBlePicker(); };
  document.getElementById("btn-ble-pick-cancel")?.addEventListener("click", cancel);
  document.getElementById("btn-ble-pick-cancel-2")?.addEventListener("click", cancel);
  document.getElementById("ble-picker-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "ble-picker-overlay") cancel();
  });

  // Live device list updates from main process
  window.api.onBleDevices?.((list) => showBlePicker(list));
  window.api.onBleClosePicker?.(() => hideBlePicker());

  // Callsign input: load, save on change, refresh dot
  const csInput = document.getElementById("input-callsign");
  if (csInput) {
    csInput.value = getUserCallsign();
    csInput.addEventListener("input", () => {
      setUserCallsign(csInput.value);
      refreshCallsignDot();
    });
  }

  // DTMF input + Send
  const input = document.getElementById("dtmf-input");
  const send = document.getElementById("dtmf-send");
  const doSend = () => {
    if (!input) return;
    bleSendDTMF(input.value);
    input.value = "";
  };
  send?.addEventListener("click", doSend);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSend();
  });

  // Quick DTMF buttons in the bar
  document.querySelectorAll(".dtmf-quick").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.getAttribute("data-dtmf");
      if (code) bleSendDTMF(code);
    });
  });

  // Command dropdown in DTMF bar (reboot, svxlink-*, 4g-*, poweroff)
  const cmdSelect = document.getElementById("ble-cmd-select");
  cmdSelect?.addEventListener("change", () => {
    const cmd = cmdSelect.value;
    if (!cmd) return;
    if (["reboot", "poweroff"].includes(cmd) && !confirm(`Send "${cmd}" to the hotspot?`)) {
      cmdSelect.selectedIndex = 0;
      return;
    }
    bleSendCommand(cmd);
    cmdSelect.selectedIndex = 0;
  });

  // TG header click → send 91<tg># via DTMF
  theadRow?.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-tg]");
    if (!th || !ble.writeChar) return;
    bleSendDTMF(`91${th.dataset.tg}#`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  initThemeDefaultDark();
  initMapVisible();
  initMap();
  initTitleBar();
  initSettings();
  initBLE();
  try { window.api.setPreferredBleName?.(getSavedDeviceName()); } catch {}
  // Initial BLE status (auto-reconnect is kicked off from main.js with a
  // synthetic user gesture after did-finish-load).
  setBleStatus("Not connected", "");

  // Load config from Electron main process (IPC) instead of /config.json
  const cfg = await window.api.loadSettings();
  applyConfig(cfg);
  startPortalAutoUpdate();

  restoreUiPrefs();
  buildTgHeader();
  initHoverTooltips();

  [showRepeatersEl, showHotspotsEl, activeOnlyEl, windowSelectEl].forEach((el) => {
    if (!el) return;
    el.addEventListener("change", () => { persistUiPrefs(); renderAll(); });
  });

  setInterval(() => renderTable(), 1000);

  connectWs();
  renderAll();
}

main().catch((err) => {
  console.error("SVX Portal startup failed:", err);
  if (statusEl) {
    statusEl.textContent = "Startup failed";
    statusEl.className = "conn bad";
  }
  if (titlebarStatusEl) {
    titlebarStatusEl.textContent = "Error";
    titlebarStatusEl.className = "bad";
  }
});
