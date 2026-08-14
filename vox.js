/* ============================================================
   VoxLens — vox.js
   UI + transport + offline render for the all-in-one vocal chain.
   Preview runs the pure-JS DSP (vox-dsp.js) inside an AudioWorklet;
   export renders the same DSP directly — bit-identical processing.
   ============================================================ */
'use strict';

const $ = id => document.getElementById(id);

/* ==================== presets ==================== */
const PRESETS = {
  default: {},
  narration: {
    gateOn: 1, gateThr: -58, gateRange: -30, gateRel: 120,
    dssOn: 1, dssFreq: 6000, dssThr: -48, dssAmt: 0.65,
    eqOn: 1, eqHpf: 75, eqLow: 1.5, eqTone: 1, eqAir: 3,
    cmpOn: 1, cmpThr: -18, cmpRatio: 3, cmpAtk: 10, cmpRel: 140, cmpMake: 2,
    satOn: 1, satDrive: 7, satMix: 0.45,
    limOn: 1, limCeil: -1, outGain: 0,
  },
  song: {
    gateOn: 0,
    dssOn: 1, dssFreq: 7000, dssThr: -42, dssAmt: 0.6,
    eqOn: 1, eqHpf: 90, eqLow: 0, eqTone: 2, eqAir: 4.5,
    cmpOn: 1, cmpThr: -16, cmpRatio: 3.5, cmpAtk: 6, cmpRel: 120, cmpMake: 3,
    satOn: 1, satDrive: 9, satMix: 0.5,
    limOn: 1, limCeil: -1, outGain: 0,
  },
  podcast: {
    gateOn: 1, gateThr: -50, gateRange: -40, gateRel: 100,
    dssOn: 1, dssFreq: 6500, dssThr: -46, dssAmt: 0.7,
    eqOn: 1, eqHpf: 85, eqLow: 0.5, eqTone: 1, eqAir: 2,
    cmpOn: 1, cmpThr: -20, cmpRatio: 4, cmpAtk: 8, cmpRel: 160, cmpMake: 3,
    satOn: 1, satDrive: 5, satMix: 0.35,
    limOn: 1, limCeil: -1, outGain: 0,
  },
  polish: {
    gateOn: 0,
    dssOn: 1, dssFreq: 7000, dssThr: -44, dssAmt: 0.45,
    eqOn: 1, eqHpf: 60, eqLow: 0, eqTone: 0.5, eqAir: 2,
    cmpOn: 1, cmpThr: -20, cmpRatio: 2, cmpAtk: 12, cmpRel: 180, cmpMake: 1.5,
    satOn: 1, satDrive: 3, satMix: 0.3,
    limOn: 1, limCeil: -1, outGain: 0,
  },
};

const MODULES = [
  { id: 'gate', title: 'Gate',       toggle: 'gateOn', gr: 'gate', params: ['gateThr', 'gateRange', 'gateRel'] },
  { id: 'dss',  title: 'De-Ess',     toggle: 'dssOn',  gr: 'dss',  params: ['dssFreq', 'dssThr', 'dssAmt'] },
  { id: 'eq',   title: 'Tone EQ',    toggle: 'eqOn',               params: ['eqHpf', 'eqLow', 'eqTone', 'eqAir'] },
  { id: 'cmp',  title: 'Compressor', toggle: 'cmpOn',  gr: 'cmp',  params: ['cmpThr', 'cmpRatio', 'cmpAtk', 'cmpRel', 'cmpMake'] },
  { id: 'sat',  title: 'Heat',       toggle: 'satOn',              params: ['satDrive', 'satMix'] },
  { id: 'out',  title: 'Output',     toggle: 'limOn',  gr: 'lim',  params: ['outGain', 'limCeil'] },
];

/* ==================== value formatting ==================== */
function fmtVal(def, v) {
  switch (def.unit) {
    case 'dB': {
      const s = Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1);
      return (v > 0 ? '+' : '') + s + ' dB';
    }
    case 'Hz': return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + ' kHz' : Math.round(v) + ' Hz';
    case 'ms': return v < 10 ? v.toFixed(1) + ' ms' : Math.round(v) + ' ms';
    case ':1': return (v < 10 ? v.toFixed(1) : v.toFixed(0)) + ':1';
    case 'x100': return Math.round(v * 100) + '%';
    default: return String(v);
  }
}

/* ==================== knob widget ==================== */
const KNOB_PX = 54, KNOB_DPR = Math.min(2, window.devicePixelRatio || 1);
const ARC0 = Math.PI * 0.75, ARC1 = Math.PI * 2.25; // 270° sweep, gap at bottom

class Knob {
  constructor(def, onChange) {
    this.def = def;
    this.onChange = onChange;
    this.min = def.min; this.max = def.max;

    const wrap = document.createElement('div');
    wrap.className = 'knob-wrap';
    const cv = document.createElement('canvas');
    cv.width = KNOB_PX * KNOB_DPR; cv.height = KNOB_PX * KNOB_DPR;
    cv.tabIndex = 0;
    cv.setAttribute('role', 'slider');
    cv.setAttribute('aria-label', def.label);
    cv.setAttribute('aria-valuemin', def.min);
    cv.setAttribute('aria-valuemax', def.max);
    this.cv = cv;
    this.labVal = document.createElement('span');
    this.labVal.className = 'knob-val';
    const labName = document.createElement('span');
    labName.className = 'knob-label';
    labName.textContent = def.label;
    wrap.append(cv, labName, this.labVal);
    if (def.hint) {
      const h = document.createElement('span');
      h.className = 'knob-hint'; h.textContent = def.hint;
      wrap.appendChild(h);
    }
    this.el = wrap;

    let dragY = 0, dragNorm = 0, dragging = false;
    cv.addEventListener('pointerdown', e => {
      dragging = true; dragY = e.clientY; dragNorm = this.norm;
      cv.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    cv.addEventListener('pointermove', e => {
      if (!dragging) return;
      const range = e.shiftKey ? 1200 : 150;
      this.setNorm(dragNorm + (dragY - e.clientY) / range, true);
    });
    cv.addEventListener('pointerup', () => { dragging = false; });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      this.setNorm(this.norm + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.006 : 0.04), true);
    }, { passive: false });
    cv.addEventListener('dblclick', () => this.set(this.def.def, true));
    cv.addEventListener('keydown', e => {
      const step = e.shiftKey ? 0.004 : 0.03;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { this.setNorm(this.norm + step, true); e.preventDefault(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { this.setNorm(this.norm - step, true); e.preventDefault(); }
      else if (e.key === 'Home') { this.set(this.min, true); e.preventDefault(); }
      else if (e.key === 'End') { this.set(this.max, true); e.preventDefault(); }
    });

    this.set(def.def, false);
  }

  valToNorm(v) {
    if (this.def.curve === 'log') return Math.log(v / this.min) / Math.log(this.max / this.min);
    return (v - this.min) / (this.max - this.min);
  }
  normToVal(n) {
    if (this.def.curve === 'log') return this.min * Math.pow(this.max / this.min, n);
    return this.min + n * (this.max - this.min);
  }
  setNorm(n, fire) { this.set(this.normToVal(Math.max(0, Math.min(1, n))), fire); }
  set(v, fire) {
    this.value = Math.max(this.min, Math.min(this.max, v));
    this.norm = this.valToNorm(this.value);
    this.cv.setAttribute('aria-valuenow', this.value.toFixed(3));
    this.labVal.textContent = fmtVal(this.def, this.value);
    this.draw();
    if (fire) this.onChange(this.def.key, this.value);
  }

  draw() {
    const ctx = this.cv.getContext('2d');
    const s = KNOB_PX * KNOB_DPR, c = s / 2, r = c - 6 * KNOB_DPR;
    ctx.clearRect(0, 0, s, s);

    // body
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = '#171b26';
    ctx.fill();
    ctx.lineWidth = 1 * KNOB_DPR;
    ctx.strokeStyle = '#2a3040';
    ctx.stroke();

    // track
    const arcR = r - 5 * KNOB_DPR;
    ctx.beginPath();
    ctx.arc(c, c, arcR, ARC0, ARC1);
    ctx.strokeStyle = '#262b3a';
    ctx.lineWidth = 3 * KNOB_DPR;
    ctx.lineCap = 'round';
    ctx.stroke();

    // value arc
    const ang = ARC0 + this.norm * (ARC1 - ARC0);
    ctx.beginPath();
    ctx.arc(c, c, arcR, ARC0, ang);
    ctx.strokeStyle = '#f5a623';
    ctx.stroke();

    // pointer
    ctx.beginPath();
    const pr = arcR - 6 * KNOB_DPR;
    ctx.moveTo(c + Math.cos(ang) * pr * 0.55, c + Math.sin(ang) * pr * 0.55);
    ctx.lineTo(c + Math.cos(ang) * pr, c + Math.sin(ang) * pr);
    ctx.strokeStyle = '#ffc862';
    ctx.lineWidth = 2 * KNOB_DPR;
    ctx.stroke();
  }
}

/* ==================== param store ==================== */
const params = VoxDSP.defaultParams();
const knobs = {};       // key -> Knob
const moduleEls = {};   // module id -> {card, badge}
let saveTimer = null;

function pushParam(key) {
  if (voxNode) voxNode.parameters.get(key).setValueAtTime(params[key], audioCtx.currentTime);
}
function onParamChange(key, v) {
  params[key] = v;
  pushParam(key);
  scheduleSave();
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('voxlens.v1', JSON.stringify({ preset: $('presetSel').value, params })); } catch (e) { /* private mode */ }
  }, 300);
}

function buildChain() {
  const host = $('chainPanel');
  for (const mod of MODULES) {
    const card = document.createElement('div');
    card.className = 'module';

    const head = document.createElement('div');
    head.className = 'mod-head';
    const title = document.createElement('span');
    title.className = 'mod-title';
    title.innerHTML = `<span class="mod-dot"></span>${mod.title}`;
    const toggle = document.createElement('button');
    toggle.className = 'mod-toggle';
    toggle.title = `Toggle ${mod.title}`;
    toggle.setAttribute('aria-label', `${mod.title} on/off`);
    head.append(title, toggle);

    let badge = null;
    if (mod.gr) {
      badge = document.createElement('span');
      badge.className = 'gr-badge';
      badge.textContent = '−0.0';
      badge.title = 'Gain reduction (dB)';
      head.appendChild(badge);
    }
    card.appendChild(head);

    const row = document.createElement('div');
    row.className = 'knob-row';
    for (const key of mod.params) {
      const k = new Knob(VoxDSP.PARAM_MAP[key], onParamChange);
      knobs[key] = k;
      row.appendChild(k.el);
    }
    card.appendChild(row);
    host.appendChild(card);
    moduleEls[mod.id] = { card, badge, toggleKey: mod.toggle };

    toggle.addEventListener('click', () => {
      const v = params[mod.toggle] > 0.5 ? 0 : 1;
      params[mod.toggle] = v;
      pushParam(mod.toggle);
      syncModuleUI(mod.id);
      scheduleSave();
    });
  }
  for (const mod of MODULES) syncModuleUI(mod.id);
}

function syncModuleUI(id) {
  const m = moduleEls[id];
  const on = params[m.toggleKey] > 0.5;
  m.card.classList.toggle('on', on);
  if (m.badge) m.badge.textContent = '−0.0';
}

function applyPreset(key) {
  const base = VoxDSP.defaultParams();
  Object.assign(params, base, PRESETS[key] || {});
  for (const k in knobs) knobs[k].set(params[k], false);
  for (const kk in params) pushParam(kk);
  for (const mod of MODULES) syncModuleUI(mod.id);
  scheduleSave();
}

function restoreSession() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('voxlens.v1') || 'null'); } catch (e) { /* ignore */ }
  if (saved && saved.params) {
    Object.assign(params, saved.params);
    if (saved.preset && PRESETS[saved.preset] !== undefined) $('presetSel').value = saved.preset;
  }
  for (const k in knobs) knobs[k].set(params[k], false);
  for (const mod of MODULES) syncModuleUI(mod.id);
}

/* ==================== audio engine ==================== */
let audioCtx = null, voxNode = null, workletOk = true;
let buf = null, wavePeaks = [], playPos = 0, playStartCtx = 0, playStartOff = 0, srcNode = null, playing = false;
let baseName = 'vocal';

async function ensureCtx() {
  if (audioCtx) return true;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (!audioCtx.audioWorklet) { workletOk = false; return true; }
  try {
    await audioCtx.audioWorklet.addModule('vox-dsp.js');
    await audioCtx.audioWorklet.addModule('vox-worklet.js');
    voxNode = new AudioWorkletNode(audioCtx, 'voxlens-chain', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    voxNode.connect(audioCtx.destination);
    voxNode.port.onmessage = onMeterMsg;
    for (const k in params) pushParam(k);
  } catch (err) {
    console.error('AudioWorklet init failed:', err);
    workletOk = false;
  }
  return true;
}

async function loadFile(file) {
  try {
    await ensureCtx();
    const ab = await file.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(ab);
    if (decoded.numberOfChannels > 2) {
      alert('VoxLens handles mono or stereo files — this one has ' + decoded.numberOfChannels + ' channels.');
      return;
    }
    stopPlayback();
    buf = decoded;
    baseName = (file.name || 'vocal').replace(/\.[^.]+$/, '');
    playPos = 0;
    $('fileName').textContent = file.name;
    $('fileMeta').textContent = `${fmtTime(buf.duration)} · ${buf.sampleRate} Hz · ${buf.numberOfChannels === 1 ? 'mono' : 'stereo'}`;
    $('playerPanel').classList.remove('hidden');
    $('chainPanel').classList.remove('hidden');
    $('exportNote').textContent = workletOk
      ? 'Real-time preview active — every knob processes live.'
      : 'This browser lacks AudioWorklet — live preview disabled, but Export renders fully offline.';
    buildPeaks();
    drawWave();
    if (!workletOk) $('playBtn').disabled = true;
  } catch (err) {
    alert('Could not load this file: ' + err.message + '\nUse an audio file (WAV/MP3/FLAC/M4A/OGG).');
    console.error(err);
  }
}

/* ---------- transport ---------- */
let playStartWall = 0;
function updatePlayBtn() { $('playBtn').textContent = playing ? '❚❚ Pause' : '▶ Play'; }

function play(from) {
  if (!buf || !workletOk) return;
  audioCtx.resume();
  stopSrcOnly();
  srcNode = audioCtx.createBufferSource();
  srcNode.buffer = buf;
  srcNode.connect(voxNode);
  srcNode.onended = () => {
    if (playing && performance.now() - playStartWall > (buf.duration - playStartOff) * 1000 - 120) {
      playing = false; playPos = 0; updatePlayBtn(); drawWave();
      $('timeLabel').textContent = `${fmtTime(0)} / ${fmtTime(buf.duration)}`;
    }
  };
  srcNode.start(0, from);
  playStartCtx = audioCtx.currentTime;
  playStartWall = performance.now();
  playStartOff = from;
  playing = true;
  updatePlayBtn();
}

function curTime() {
  if (!buf) return 0;
  if (!playing) return playPos;
  return Math.min(buf.duration, playStartOff + (audioCtx.currentTime - playStartCtx));
}
function stopSrcOnly() { if (srcNode) { try { srcNode.onended = null; srcNode.stop(); } catch (e) { /* not started */ } srcNode.disconnect(); srcNode = null; } }
function stopPlayback() { stopSrcOnly(); playing = false; playPos = 0; updatePlayBtn(); }

/* ---------- waveform ---------- */
function buildPeaks() {
  const w = Math.max(300, $('waveCanvas').clientWidth || 800);
  const n = buf.length, chs = buf.numberOfChannels;
  const L = buf.getChannelData(0), R = chs > 1 ? buf.getChannelData(1) : L;
  wavePeaks = new Float32Array(w);
  const per = n / w;
  for (let x = 0; x < w; x++) {
    const s = Math.floor(x * per), e = Math.min(n, Math.floor((x + 1) * per));
    let pk = 0;
    for (let i = s; i < e; i += 8) {
      const a = Math.abs(L[i]), b = Math.abs(R[i]);
      const m = a > b ? a : b;
      if (m > pk) pk = m;
    }
    wavePeaks[x] = pk;
  }
}
function drawWave() {
  const cv = $('waveCanvas'), dpr = KNOB_DPR;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const n = wavePeaks.length, mid = cv.height / 2;
  const t = curTime(), frac = buf ? t / buf.duration : 0;
  for (let x = 0; x < n; x++) {
    const px = x / n * cv.width;
    const amp = Math.max(1, wavePeaks[x] * mid * 0.92);
    ctx.fillStyle = x / n <= frac ? '#f5a623' : '#2c3347';
    ctx.fillRect(px, mid - amp, Math.max(1, cv.width / n - 1), amp * 2);
  }
  // playhead
  ctx.fillStyle = 'rgba(255,200,98,.9)';
  ctx.fillRect(frac * cv.width, 0, Math.max(1, dpr), cv.height);
}

function tickTransport() {
  if (buf) {
    $('timeLabel').textContent = `${fmtTime(curTime())} / ${fmtTime(buf.duration)}`;
    drawWave();
  }
}
setInterval(tickTransport, 66); // ~15 fps playhead, cheap

/* ---------- meters ---------- */
function dbOf(x) { return x > 1e-6 ? 20 * Math.log10(x) : -99; }
function onMeterMsg(e) {
  const m = e.data;
  if (!m || m.type !== 'meters') return;
  const dbIn = dbOf(m.inPk), dbOut = dbOf(m.outPk);
  $('mIn').style.width = Math.max(0, Math.min(100, (dbIn + 60) / 60 * 100)) + '%';
  $('mOut').style.width = Math.max(0, Math.min(100, (dbOut + 60) / 60 * 100)) + '%';
  $('mInDb').textContent = dbIn <= -99 ? '−∞' : dbIn.toFixed(1) + ' dB';
  $('mOutDb').textContent = dbOut <= -99 ? '−∞' : dbOut.toFixed(1) + ' dB';
  setGr('gate', m.gate); setGr('dss', m.dss); setGr('cmp', m.cmp); setGr('lim', m.lim);
}
function setGr(id, v) {
  const m = moduleEls[id];
  if (!m || !m.badge) return;
  m.badge.textContent = '−' + v.toFixed(1);
  m.badge.classList.toggle('hot', v > 0.5);
}

/* ---------- export (pure-DSP offline render, 24-bit WAV) ---------- */
async function exportWav() {
  if (!buf) return;
  const btn = $('exportBtn'), note = $('exportNote');
  btn.disabled = true;
  try {
    stopPlayback();
    const nCh = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length;
    const chain = new VoxDSP.VoxChain(sr, nCh);
    chain.setParams(params);
    chain.reset();

    const outs = [];
    for (let c = 0; c < nCh; c++) outs.push(new Float32Array(n));
    const CHUNK = 16384;
    let lastNote = 0;
    for (let off = 0; off < n; off += CHUNK) {
      const len = Math.min(CHUNK, n - off);
      const parts = [];
      for (let c = 0; c < nCh; c++) parts.push(buf.getChannelData(c).slice(off, off + len));
      chain.processBlock(parts, len);
      for (let c = 0; c < nCh; c++) outs[c].set(parts[c], off);
      if (off - lastNote > CHUNK * 8) {
        lastNote = off;
        note.textContent = `Rendering… ${Math.round(off / n * 100)}%`;
        await new Promise(r => setTimeout(r, 0));
      }
    }
    // true peak estimate of the render
    let pk = 0;
    for (let c = 0; c < nCh; c++) for (let i = 0; i < n; i += 4) { const a = Math.abs(outs[c][i]); if (a > pk) pk = a; }

    const ab = encodeWav24(outs, sr, nCh, n);
    const blob = new Blob([ab], { type: 'audio/wav' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${baseName}_voxlens.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    note.textContent = `Exported ${a.download} · ${sr} Hz 24-bit · peak ${dbOf(pk).toFixed(1)} dBFS`;
  } catch (err) {
    console.error(err);
    note.textContent = 'Export failed: ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

function encodeWav24(chans, sr, nCh, n) {
  const blockAlign = nCh * 3, dataSize = n * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(ab);
  let o = 0;
  const ws = s => { for (let i = 0; i < s.length; i++) dv.setUint8(o++, s.charCodeAt(i)); };
  const u32 = v => { dv.setUint32(o, v, true); o += 4; };
  const u16 = v => { dv.setUint16(o, v, true); o += 2; };
  ws('RIFF'); u32(36 + dataSize); ws('WAVE');
  ws('fmt '); u32(16); u16(1); u16(nCh); u32(sr); u32(sr * blockAlign); u16(blockAlign); u16(24);
  ws('data'); u32(dataSize);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nCh; c++) {
      const x = Math.max(-1, Math.min(1, chans[c][i]));
      let v = Math.round(x * 8388607);
      if (v < 0) v += 16777216; // two's complement 24-bit
      dv.setUint8(o++, v & 255);
      dv.setUint8(o++, (v >> 8) & 255);
      dv.setUint8(o++, (v >> 16) & 255);
    }
  }
  return ab;
}

/* ---------- helpers ---------- */
function fmtTime(s) {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/* ==================== wiring ==================== */
buildChain();
restoreSession();

$('presetSel').addEventListener('change', e => applyPreset(e.target.value));

const dz = $('dropZone');
dz.addEventListener('click', e => { if (e.target !== $('fileInput')) $('fileInput').click(); });
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag');
  if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
});
$('fileInput').addEventListener('change', e => { if (e.target.files.length) loadFile(e.target.files[0]); });

$('playBtn').addEventListener('click', () => {
  if (!buf) return;
  if (playing) { playPos = curTime(); stopSrcOnly(); playing = false; updatePlayBtn(); }
  else play(playPos);
});
$('stopBtn').addEventListener('click', () => { stopPlayback(); drawWave(); $('timeLabel').textContent = `${fmtTime(0)} / ${fmtTime(buf ? buf.duration : 0)}`; });
$('waveCanvas').addEventListener('click', e => {
  if (!buf) return;
  const rect = e.target.getBoundingClientRect();
  const t = (e.clientX - rect.left) / rect.width * buf.duration;
  if (playing) play(t); else { playPos = t; drawWave(); tickTransport(); }
});
$('bypassBtn').addEventListener('click', () => {
  params.bypass = params.bypass > 0.5 ? 0 : 1;
  pushParam('bypass');
  $('bypassBtn').classList.toggle('armed', params.bypass > 0.5);
  scheduleSave();
});
$('exportBtn').addEventListener('click', exportWav);

window.addEventListener('resize', () => { if (buf) drawWave(); });
