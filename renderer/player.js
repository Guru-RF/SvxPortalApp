/*
 * Live audio "Listen" player for the SVX Portal desktop app.
 *
 * Adapted from SvxReflectorPortal/public/player.js. Uses WebCodecs Opus
 * (always available in Electron's Chromium) — no WASM fallback needed.
 * Talkgroup list is discovered from the stream's tg_list message.
 * Only one TG plays at a time; picking another switches, picking the
 * active one stops.
 */

const FRAME_SR = 48000; // decoder output sample rate
const TARGET_MS = 150; // jitter buffer prebuffer
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const ICON_STOP =
  '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

let cfg = null;
let ws = null;
let audioCtx = null;
let workletReady = false;

let availableTgs = [];
let activeTg = null;
let channel = null;
let starting = false;

let reconnectTimer = null;
let reconnectDelay = 1000;
let manualClose = false;

let wrapEl = null;
let btnsEl = null;

// Volume & mute always start fresh — 100% unmuted on every launch.
let volume = 1;
let muted = false;

/* ---------- one talkgroup channel ---------- */

class Channel {
  constructor(tg) {
    this.tg = tg;
    this.ts = 0;
    this.gain = audioCtx.createGain();
    this.gain.gain.value = muted ? 0 : volume;
    this.gain.connect(audioCtx.destination);
    this.node = new AudioWorkletNode(audioCtx, "jitter-player", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { sampleRate: FRAME_SR, targetMs: TARGET_MS },
    });
    this.node.connect(this.gain);

    this.decoder = new AudioDecoder({
      output: (audioData) => {
        const n = audioData.numberOfFrames;
        const pcm = new Float32Array(n);
        try {
          audioData.copyTo(pcm, { planeIndex: 0, format: "f32-planar" });
        } catch (_) {
          audioData.copyTo(pcm, { planeIndex: 0 });
        }
        this.node.port.postMessage({ pcm }, [pcm.buffer]);
        audioData.close();
      },
      error: (e) => console.warn(`TG ${this.tg} decode error`, e),
    });
    this.decoder.configure({
      codec: "opus",
      sampleRate: FRAME_SR,
      numberOfChannels: 1,
    });
  }

  decode(opusBytes) {
    if (this.decoder.state !== "configured") return;
    this.decoder.decode(
      new EncodedAudioChunk({
        type: "key",
        timestamp: this.ts,
        data: opusBytes,
      }),
    );
    this.ts += 20000; // 20 ms in µs
  }

  destroy() {
    try { this.node.port.postMessage({ flush: true }); } catch (_) {}
    try { this.node.disconnect(); } catch (_) {}
    try { this.gain.disconnect(); } catch (_) {}
    if (this.decoder && this.decoder.state !== "closed") {
      try { this.decoder.close(); } catch (_) {}
    }
  }
}

/* ---------- WebSocket ---------- */

function wsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function streamWsUrl() {
  let base = String(cfg.streamUrl || "").trim().replace(/\/+$/, "");
  base = base.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");
  const tok = cfg.streamToken
    ? `?token=${encodeURIComponent(cfg.streamToken)}`
    : "";
  return /\/ws$/.test(base) ? `${base}${tok}` : `${base}/ws${tok}`;
}

function scheduleReconnect() {
  if (reconnectTimer || manualClose) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 15000);
    playerConnectWs();
  }, reconnectDelay);
}

function playerConnectWs() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  let sock;
  try { sock = new WebSocket(streamWsUrl()); }
  catch (_) { scheduleReconnect(); return; }
  ws = sock;
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    console.log("[player] ws open");
    reconnectDelay = 1000;
    if (activeTg != null) wsSend({ type: "subscribe", tgs: [activeTg] });
  };
  ws.onclose = (ev) => {
    console.log("[player] ws close", ev.code, ev.reason);
    if (channel) channel.node.port.postMessage({ flush: true });
    if (ws === sock) ws = null;
    scheduleReconnect();
  };
  ws.onerror = (e) => console.warn("[player] ws error", e);
  ws.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.type === "tg_list") setTgList(msg.tgs || []);
      return;
    }
    const dv = new DataView(ev.data);
    if (dv.getUint8(0) !== 1) return; // 1 = audio frame
    const tg = dv.getUint32(1);
    if (tg !== activeTg || !channel) return;
    const opus = new Uint8Array(ev.data, 7);
    channel.decode(opus);
  };
}

/* ---------- playback ---------- */

async function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: FRAME_SR,
    });
  }
  if (!workletReady) {
    await audioCtx.audioWorklet.addModule("./audio-worklet.js");
    workletReady = true;
  }
  if (audioCtx.state === "suspended") await audioCtx.resume();
}

async function stop() {
  if (activeTg != null) wsSend({ type: "unsubscribe", tgs: [activeTg] });
  if (channel) { channel.destroy(); channel = null; }
  activeTg = null;
  renderButtons();
}

async function play(tg) {
  if (starting) return;
  starting = true;
  try {
    if (activeTg != null && activeTg !== tg) {
      wsSend({ type: "unsubscribe", tgs: [activeTg] });
      if (channel) { channel.destroy(); channel = null; }
    }
    await ensureAudio();
    activeTg = tg;
    channel = new Channel(tg);
    if (!ws || ws.readyState !== WebSocket.OPEN) playerConnectWs();
    wsSend({ type: "subscribe", tgs: [tg] });
  } catch (e) {
    console.warn("stream play failed", e);
    activeTg = null;
    if (channel) { channel.destroy(); channel = null; }
  } finally {
    starting = false;
    renderButtons();
  }
}

function onPick(tg) {
  if (tg === activeTg) stop();
  else play(tg);
}

/* ---------- UI ---------- */

function setTgList(tgs) {
  const seen = new Set();
  availableTgs = [];
  for (const t of tgs) {
    const n = Number(t);
    if (Number.isFinite(n) && !seen.has(n)) {
      seen.add(n);
      availableTgs.push(n);
    }
  }
  if (activeTg != null && !seen.has(activeTg)) stop();
  renderButtons();
}

function tgLabel(tg) {
  const info = cfg && cfg.talkgroupInfo ? cfg.talkgroupInfo[String(tg)] : null;
  if (info && typeof info === "string") {
    const first = info.split("\n")[0].trim();
    if (first) return first;
  }
  return null;
}

function renderButtons() {
  if (!btnsEl) return;
  btnsEl.innerHTML = "";
  if (!availableTgs.length) {
    const span = document.createElement("span");
    span.className = "streamHint";
    span.textContent = "connecting…";
    btnsEl.appendChild(span);
    return;
  }
  for (const tg of availableTgs) {
    const b = document.createElement("button");
    const isActive = tg === activeTg;
    b.type = "button";
    b.className = "streamBtn" + (isActive ? " active" : "");
    b.setAttribute("aria-pressed", isActive ? "true" : "false");
    const name = tgLabel(tg);
    if (name) b.title = name;
    b.innerHTML =
      `<span class="streamIco" aria-hidden="true">${isActive ? ICON_STOP : ICON_PLAY}</span>` +
      `<span class="streamTg">TG ${tg}</span>`;
    b.addEventListener("click", () => onPick(tg));
    btnsEl.appendChild(b);
  }
}

/* ---------- volume / mute ---------- */

function effectiveGain() {
  return muted ? 0 : volume;
}

function applyGainToChannel() {
  if (!channel || !channel.gain) return;
  // Use setTargetAtTime for a tiny ramp so volume changes don't click.
  const now = audioCtx ? audioCtx.currentTime : 0;
  try {
    channel.gain.gain.setTargetAtTime(effectiveGain(), now, 0.01);
  } catch (_) {
    channel.gain.gain.value = effectiveGain();
  }
}

function syncVolumeUi() {
  const slider = document.getElementById("streamVolume");
  const muteBtn = document.getElementById("streamMute");
  if (slider) {
    slider.value = String(volume);
    slider.classList.toggle("muted", muted);
  }
  if (muteBtn) {
    muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    muteBtn.title = muted ? "Unmute" : "Mute";
    const on = muteBtn.querySelector(".streamIcoOn");
    const off = muteBtn.querySelector(".streamIcoOff");
    if (on) on.style.display = muted ? "none" : "";
    if (off) off.style.display = muted ? "" : "none";
  }
}

function setVolume(v) {
  const n = Math.max(0, Math.min(1, Number(v) || 0));
  volume = n;
  // Adjusting the slider implicitly unmutes (matches OS / browser behavior)
  if (muted && n > 0) muted = false;
  applyGainToChannel();
  syncVolumeUi();
}

function setMuted(m) {
  muted = !!m;
  applyGainToChannel();
  syncVolumeUi();
}

function initVolumeControls() {
  const slider = document.getElementById("streamVolume");
  const muteBtn = document.getElementById("streamMute");
  slider?.addEventListener("input", (e) => setVolume(e.target.value));
  muteBtn?.addEventListener("click", () => setMuted(!muted));
  syncVolumeUi();
}

/* ---------- init ---------- */

async function init() {
  try {
    cfg = await window.api.loadSettings();
  } catch (e) {
    console.warn("[player] loadSettings failed:", e);
    return;
  }
  console.log("[player] init — streamUrl=", cfg?.streamUrl, "token len=", (cfg?.streamToken || "").length);
  if (!cfg || !cfg.streamUrl) {
    console.log("[player] no streamUrl, listen disabled");
    return;
  }

  wrapEl = document.getElementById("streamPlayer");
  btnsEl = document.getElementById("streamBtns");
  if (!wrapEl || !btnsEl) {
    console.warn("[player] DOM elements not found");
    return;
  }
  wrapEl.style.display = "";

  initVolumeControls();

  console.log("[player] connecting to", streamWsUrl());
  renderButtons();
  playerConnectWs();

  window.addEventListener("beforeunload", () => {
    manualClose = true;
    try { if (ws) ws.close(); } catch (_) {}
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
