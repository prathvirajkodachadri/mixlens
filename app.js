'use strict';
/* ============================================================
   MixLens — audio analyzer for mixing
   100% offline, browser-based. Tuned for deep cinematic narration.
   ============================================================ */

/* ---------- tiny helpers ---------- */
const $ = id => document.getElementById(id);
const tick = () => new Promise(r => setTimeout(r, 0));
const db20 = x => 20 * Math.log10(Math.max(x, 1e-12));
const db10 = x => 10 * Math.log10(Math.max(x, 1e-12));
const fmtDb = (x, d = 1) => (x >= 0 ? '+' : '') + x.toFixed(d);
function fmtTime(s){ const m = Math.floor(s / 60); const ss = s % 60; return m + ':' + (ss < 10 ? '0' : '') + ss.toFixed(1); }
function sortedCopy(arr){ return Float64Array.from(arr).sort(); }
function percentile(sorted, q){ if(!sorted.length) return 0; return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]; }

/* ---------- FFT (iterative radix-2) ---------- */
class FFT {
  constructor(n){
    this.n = n;
    this.rev = new Uint32Array(n);
    const bits = Math.round(Math.log2(n));
    for(let i = 0; i < n; i++){
      let x = i, r = 0;
      for(let b = 0; b < bits; b++){ r = (r << 1) | (x & 1); x >>= 1; }
      this.rev[i] = r;
    }
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for(let i = 0; i < n / 2; i++){
      this.cos[i] = Math.cos(2 * Math.PI * i / n);
      this.sin[i] = Math.sin(2 * Math.PI * i / n);
    }
  }
  transform(re, im){
    const n = this.n, rev = this.rev;
    for(let i = 0; i < n; i++){
      const j = rev[i];
      if(j > i){
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for(let len = 2; len <= n; len <<= 1){
      const half = len >> 1, step = n / len;
      for(let i = 0; i < n; i += len){
        for(let k = 0; k < half; k++){
          const c = this.cos[k * step], s = this.sin[k * step];
          const j = i + k + half;
          const tre = re[j] * c + im[j] * s;
          const tim = im[j] * c - re[j] * s;
          re[j] = re[i + k] - tre; im[j] = im[i + k] - tim;
          re[i + k] += tre; im[i + k] += tim;
        }
      }
    }
  }
}

/* ---------- biquads (EBU R128 K-weighting, libebur128-exact design) ---------- */
function kWeightingFilters(fs){
  // Stage 1: pre-filter (high shelf, +4 dB)
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan(Math.PI * f0 / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let v = 1 + K / Q + K * K;
  const shelf = [
    (Vh + Vb * K / Q + K * K) / v,
    2 * (K * K - Vh) / v,
    (Vh - Vb * K / Q + K * K) / v,
    2 * (K * K - 1) / v,
    (1 - K / Q + K * K) / v,
  ];
  // Stage 2: RLB high-pass (b unnormalized — matches ITU coefficient tables)
  f0 = 38.13547087602444; Q = 0.5003270388234198;
  K = Math.tan(Math.PI * f0 / fs);
  v = 1 + K / Q + K * K;
  const hp = [1, -2, 1, 2 * (K * K - 1) / v, (1 - K / Q + K * K) / v];
  return { shelf, hp };
}
function applyBiquad(x, c){
  const out = new Float32Array(x.length);
  const [b0, b1, b2, a1, a2] = c;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for(let i = 0; i < x.length; i++){
    const v = x[i];
    const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y; out[i] = y;
  }
  return out;
}

/* ---------- config ---------- */
const ZONES = [
  { name: 'Sub',       from: 20,    to: 60,    col: '#8f6bff', tip: 'rumble · HPF zone' },
  { name: 'Chest',     from: 60,    to: 150,   col: '#f5a623', tip: 'deep-voice foundation' },
  { name: 'Warmth',    from: 150,   to: 300,   col: '#ffc862', tip: 'body & warmth' },
  { name: 'Mud',       from: 300,   to: 500,   col: '#e07b39', tip: 'boxiness zone' },
  { name: 'Body',      from: 500,   to: 2000,  col: '#5ab0ff', tip: 'speech body' },
  { name: 'Presence',  from: 2000,  to: 5000,  col: '#3ecf8e', tip: 'clarity & authority' },
  { name: 'Sibilance', from: 5000,  to: 9000,  col: '#ff5d5d', tip: 'ess / harsh zone' },
  { name: 'Air',       from: 9000,  to: 16000, col: '#b7c3ff', tip: 'top-end sheen' },
];

const PRESETS = {
  narration: { label: 'Deep Narration (KGF)', chestWarn: -3, mudWarn: 3, presWarn: -4, sibWarn: 3, airNote: -6, crestMax: 14, lraMax: 10, noiseWarn: -50 },
  vocal:     { label: 'Vocal / Song',         chestWarn: -5, mudWarn: 4, presWarn: -3, sibWarn: 3.5, airNote: -8, crestMax: 16, lraMax: 12, noiseWarn: -48 },
  mix:       { label: 'Full Mix / Reference', chestWarn: -6, mudWarn: 5, presWarn: -4, sibWarn: 4, airNote: -9, crestMax: 14, lraMax: 14, noiseWarn: -45 },
};

/* ---------- loudness (EBU R128 approximation) ---------- */
function computeLoudness(L, R, fs, isStereo, onProg){
  const { shelf, hp } = kWeightingFilters(fs);
  const fl = applyBiquad(applyBiquad(L, shelf), hp);
  const fr = isStereo ? applyBiquad(applyBiquad(R, shelf), hp) : null;
  const n = fl.length;
  // decimated cumulative power (factor 16) to keep memory low
  // EBU R128: block power = SUM of per-channel mean squares (stereo reads +3 LU vs dual mono by design)
  const D = 16, g = Math.floor(n / D);
  const cum = new Float64Array(g + 1);
  for(let k = 0; k < g; k++){
    let s = 0;
    const base = k * D;
    if(isStereo) for(let i = 0; i < D; i++) s += fl[base + i] * fl[base + i] + fr[base + i] * fr[base + i];
    else for(let i = 0; i < D; i++) s += fl[base + i] * fl[base + i];
    cum[k + 1] = cum[k] + s;
  }
  const sumRange = (a, b) => { // a,b in samples
    const ka = Math.min(g, Math.floor(a / D)), kb = Math.min(g, Math.floor(b / D));
    return (cum[kb] - cum[ka]) / Math.max(1, (kb - ka) * D);
  };
  const block = Math.max(D, Math.round(0.4 * fs / D) * D);
  const hop = Math.max(D, Math.round(0.1 * fs / D) * D);
  const pows = [];
  for(let st = 0; st + block <= n; st += hop) pows.push(sumRange(st, st + block));
  if(!pows.length) pows.push(sumRange(0, n));
  const absThr = Math.pow(10, (-70 + 0.691) / 10);
  let sAbs = 0, cAbs = 0;
  for(const p of pows){ if(p >= absThr){ sAbs += p; cAbs++; } }
  const relThr = cAbs ? (sAbs / cAbs) * 0.1 : 0;
  let sFin = 0, cFin = 0;
  for(const p of pows){ if(p >= absThr && p >= relThr){ sFin += p; cFin++; } }
  const integrated = cFin ? -0.691 + db10(sFin / cFin) : -Infinity;
  // short-term (3 s) for max + LRA
  const sw = Math.max(block, Math.round(3 * fs / D) * D), sh = Math.round(1 * fs / D) * D;
  const shorts = [];
  for(let st = 0; st + sw <= n; st += sh) shorts.push(sumRange(st, st + sw));
  if(!shorts.length) shorts.push(sumRange(0, n));
  let sMax = 0;
  for(const p of shorts){ if(p >= relThr && p > sMax) sMax = p; }
  const shortMax = sMax > 0 ? -0.691 + db10(sMax) : integrated;
  const gated = shorts.filter(p => p >= relThr).sort((a, b) => a - b);
  let lra = 0;
  if(gated.length >= 4){
    lra = (-0.691 + db10(gated[Math.min(gated.length - 1, Math.floor(0.95 * gated.length))])) -
          (-0.691 + db10(gated[Math.floor(0.10 * gated.length)]));
  }
  return { integrated, shortMax, lra };
}

/* ---------- true peak (oversampled estimate) ---------- */
function truePeakOf(ch){
  let peak = 0;
  for(let i = 0; i < ch.length; i++){ const a = Math.abs(ch[i]); if(a > peak) peak = a; }
  const thr = peak * 0.9;
  const cands = [];
  for(let i = 1; i < ch.length - 1 && cands.length < 400; i++){
    const a = Math.abs(ch[i]);
    if(a >= thr && a >= Math.abs(ch[i - 1]) && a >= Math.abs(ch[i + 1])) cands.push(i);
  }
  let tp = peak;
  for(const c of cands){
    const p0 = ch[Math.max(0, c - 1)], p1 = ch[c], p2 = ch[Math.min(ch.length - 1, c + 1)], p3 = ch[Math.min(ch.length - 1, c + 2)];
    for(let t = 0.25; t <= 0.75; t += 0.25){
      const t2 = t * t, t3 = t2 * t;
      const v = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
      if(Math.abs(v) > tp) tp = Math.abs(v);
    }
  }
  return tp;
}

/* ---------- main analysis ---------- */
async function analyzeAudio(buf, onProg){
  const fs = buf.sampleRate;
  const nCh = buf.numberOfChannels;
  const L = buf.getChannelData(0);
  const R = nCh > 1 ? buf.getChannelData(1) : L;
  const n = buf.length;
  const stats = { sampleRate: fs, channels: nCh, duration: n / fs, isMono: nCh === 1 };

  /* --- pass 1: levels, peaks, stereo --- */
  let peakL = 0, peakR = 0, clipped = 0;
  const clipTimes = [];
  let lastClipIdx = -1e9;
  let sumSq = 0, sumLR = 0, sumSqL = 0, sumSqR = 0, sumSqSum = 0, sumSqDiff = 0;
  const CH = 524288;
  for(let i = 0; i < n; i += CH){
    const end = Math.min(n, i + CH);
    for(let j = i; j < end; j++){
      const l = L[j], r = R[j], al = Math.abs(l), ar = Math.abs(r);
      if(al > peakL) peakL = al;
      if(ar > peakR) peakR = ar;
      if(al >= 0.999 || ar >= 0.999){
        clipped++;
        if(j - lastClipIdx > fs * 0.05 && clipTimes.length < 8){ clipTimes.push(j / fs); lastClipIdx = j; }
      }
      sumSq += (l * l + r * r) / 2;
      sumLR += l * r; sumSqL += l * l; sumSqR += r * r;
      const m = l + r, d = l - r;
      sumSqSum += m * m; sumSqDiff += d * d;
    }
    onProg(0.02 + 0.13 * (i / n), 'Scanning levels…');
    await tick();
  }
  const rms = Math.sqrt(sumSq / n);
  stats.peakL = peakL; stats.peakR = peakR; stats.clipped = clipped; stats.clipTimes = clipTimes;
  stats.rmsDb = db20(rms);
  stats.crestDb = db20(peakL > peakR ? peakL : peakR) - stats.rmsDb;
  stats.correlation = sumLR / Math.max(1e-12, Math.sqrt(sumSqL * sumSqR));
  stats.widthPct = sumSqDiff / Math.max(1e-12, sumSqDiff + sumSqSum) * 100;
  stats.truePeak = Math.max(truePeakOf(L), nCh > 1 ? truePeakOf(R) : 0);

  /* --- pass 2: loudness --- */
  onProg(0.16, 'K-weighting filters…');
  await tick();
  stats.loudness = computeLoudness(L, R, fs, nCh > 1, onProg);
  onProg(0.34, 'Loudness gating…');
  await tick();

  /* --- pass 3: spectrum, zones, sibilance, noise floor --- */
  const N = 4096, nBins = N / 2, binHz = fs / N;
  const fft = new FFT(N);
  const win = new Float32Array(N);
  for(let i = 0; i < N; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / N));
  const re = new Float32Array(N), im = new Float32Array(N);
  const specAcc = new Float64Array(nBins);
  const zoneAcc = new Float64Array(ZONES.length);
  const zoneBins = ZONES.map(z => [Math.max(1, Math.floor(z.from / binHz)), Math.min(nBins - 1, Math.ceil(z.to / binHz))]);
  const sibIdx = ZONES.findIndex(z => z.name === 'Sibilance');
  const subIdx = ZONES.findIndex(z => z.name === 'Sub');
  const subHiBin = Math.min(nBins - 1, Math.ceil(80 / binHz)); // rumble peak search up to 80 Hz
  const frameRmsDb = [], sibShareDb = [], subShareDb = [], subPeakHz = [], frameTimes = [];
  let totalBinSum = 0, frames = 0;
  const baseHop = stats.duration > 300 ? 4096 : 2048;
  const maxFrames = 14000;
  const possible = Math.max(1, Math.floor((n - N) / baseHop) + 1);
  const hopEff = possible > maxFrames ? Math.ceil((n - N) / maxFrames) : baseHop;

  if(n >= N){
    for(let st = 0; st + N <= n; st += hopEff){
      let ms = 0;
      for(let i = 0; i < N; i++){
        const v = (L[st + i] + R[st + i]) / 2;
        re[i] = v * win[i]; im[i] = 0; ms += v * v;
      }
      ms /= N;
      fft.transform(re, im);
      let frameTotal = 0;
      for(let k = 1; k < nBins; k++){
        const m2 = re[k] * re[k] + im[k] * im[k];
        specAcc[k] += m2; frameTotal += m2;
      }
      totalBinSum += frameTotal;
      for(let zi = 0; zi < ZONES.length; zi++){
        const [a, b] = zoneBins[zi];
        let s = 0;
        for(let k = a; k <= b; k++) s += re[k] * re[k] + im[k] * im[k];
        zoneAcc[zi] += s;
      }
      const sibSum = (() => { const [a, b] = zoneBins[sibIdx]; let s = 0; for(let k = a; k <= b; k++) s += re[k] * re[k] + im[k] * im[k]; return s; })();
      // rumble: sub-band share + dominant frequency (20–80 Hz)
      const [sa, sb] = zoneBins[subIdx];
      let subSum = 0, subPeak = sa, subPeakV = -1;
      for(let k = sa; k <= sb; k++){
        const m2 = re[k] * re[k] + im[k] * im[k];
        subSum += m2;
        if(m2 > subPeakV){ subPeakV = m2; subPeak = k; }
      }
      for(let k = sb + 1; k <= subHiBin; k++){
        const m2 = re[k] * re[k] + im[k] * im[k];
        if(m2 > subPeakV){ subPeakV = m2; subPeak = k; }
      }
      frameRmsDb.push(db10(ms + 1e-14));
      sibShareDb.push(db10(sibSum / Math.max(1e-14, frameTotal)));
      subShareDb.push(db10(subSum / Math.max(1e-14, frameTotal)));
      subPeakHz.push(subPeak * binHz);
      frameTimes.push((st + N / 2) / fs);
      frames++;
      if(frames % 300 === 0){
        onProg(0.34 + 0.6 * (st / n), 'Spectrum & sibilance…');
        await tick();
      }
    }
  }

  /* --- finalize zones & spectrum --- */
  const rmsSq = rms * rms;
  const zoneSum = zoneAcc.reduce((a, b) => a + b, 0);
  const pinkRaw = ZONES.map(z => Math.log(z.to / z.from));
  const pinkSum = pinkRaw.reduce((a, b) => a + b, 0);
  stats.zones = ZONES.map((z, i) => {
    const share = zoneSum > 0 ? zoneAcc[i] / zoneSum : 0;
    const pinkShare = pinkRaw[i] / pinkSum;
    return {
      ...z,
      levelDb: db10((zoneAcc[i] / Math.max(1e-14, totalBinSum)) * rmsSq),
      share,
      devPink: share > 0 ? db10(share / pinkShare) : -60,
    };
  });
  stats.spec = { binHz, nBins, binDb: new Float64Array(nBins) };
  for(let k = 1; k < nBins; k++){
    stats.spec.binDb[k] = db10((specAcc[k] / Math.max(1e-14, totalBinSum)) * rmsSq);
  }

  /* --- noise floor (quietest 5% of frames) --- */
  if(frameRmsDb.length >= 3){
    const sorted = sortedCopy(frameRmsDb);
    const q = Math.max(3, Math.floor(sorted.length * 0.05));
    let p = 0;
    for(let i = 0; i < q; i++) p += Math.pow(10, sorted[i] / 10);
    stats.noiseFloorDb = db10(p / q);
  } else stats.noiseFloorDb = stats.rmsDb;

  /* --- sibilance events --- */
  const sibEvents = [];
  if(sibShareDb.length){
    const med = percentile(sortedCopy(sibShareDb), 0.5);
    const thr = Math.max(med + 5, -16);
    const minLevel = stats.rmsDb - 35;
    let cur = null;
    for(let i = 0; i < sibShareDb.length; i++){
      const hit = sibShareDb[i] > thr && frameRmsDb[i] > minLevel;
      if(hit){
        if(!cur) cur = { t: frameTimes[i], str: sibShareDb[i] };
        else if(sibShareDb[i] > cur.str) { cur.str = sibShareDb[i]; cur.t = frameTimes[i]; }
      } else if(cur){
        sibEvents.push(cur); cur = null;
      }
      if(hit && cur && frameTimes[i] - cur.t > 0.25){ sibEvents.push(cur); cur = { t: frameTimes[i], str: sibShareDb[i] }; }
    }
    if(cur) sibEvents.push(cur);
  }
  stats.sibEvents = sibEvents;

  /* --- rumble events (time-localized low-frequency noise, 20–80 Hz) --- */
  const rumbleEvents = [];
  if(subShareDb.length){
    const med = percentile(sortedCopy(subShareDb), 0.5);
    const thr = Math.max(med + 6, -34); // adaptive: clearly above the file's typical sub content
    let cur = null, lastHit = -10;
    const flush = () => { if(cur){ rumbleEvents.push(cur); cur = null; } };
    for(let i = 0; i < subShareDb.length; i++){
      const hit = subShareDb[i] > thr && frameRmsDb[i] > -90;
      if(hit){
        if(!cur) cur = { t: frameTimes[i], end: frameTimes[i], str: subShareDb[i], freqs: [] };
        cur.end = frameTimes[i];
        if(subShareDb[i] > cur.str) cur.str = subShareDb[i];
        cur.freqs.push(subPeakHz[i]);
        lastHit = i;
      } else if(cur && i - lastHit > 3){
        flush(); // tolerate ~3-frame gaps (brief dips) inside one rumble event
      }
    }
    flush();
    for(const ev of rumbleEvents){
      ev.dur = Math.max(0.05, ev.end - ev.t);
      ev.f = percentile(sortedCopy(ev.freqs), 0.5); // dominant rumble frequency (median)
      delete ev.freqs;
    }
  }
  stats.rumbleEvents = rumbleEvents;
  onProg(0.98, 'Finalizing…');
  await tick();
  return stats;
}

/* ============================================================
   STATE
   ============================================================ */
let audioCtx = null;
let curBuf = null, mainStats = null, refStats = null;
let wavePeaks = null; // {min:[], max:[], cols}
let playing = false, playSrc = null, playOffset = 0, playStartedAt = 0;
let rafId = null;

function ensureCtx(){
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if(audioCtx.state === 'suspended') audioCtx.resume();
}

/* ============================================================
   SUGGESTIONS ENGINE
   ============================================================ */
function computeSuggestions(stats, presetKey, target){
  const P = PRESETS[presetKey];
  const out = [];
  const zget = name => stats.zones.find(z => z.name === name);
  const add = (sev, title, text) => out.push({ sev, title, text });

  /* loudness plan */
  const diff = target - stats.loudness.integrated;
  if(!isFinite(stats.loudness.integrated)){
    add('warn', 'Silent or near-silent file', 'No measurable loudness — check the recording.');
  } else if(diff > 0.5){
    add('info', `Raise loudness by ${diff.toFixed(1)} dB to hit ${target} LUFS`,
      diff > 3
        ? `Plan: close the gap with a compressor first (2–4 dB of gain reduction), then let a limiter take the last 1–3 dB. Don't make the limiter do all the work.`
        : `A gentle limiter or one compressor stage is enough to close this gap.`);
  } else if(diff < -1.5){
    add('warn', `File is ${(-diff).toFixed(1)} dB louder than the ${target} LUFS target`,
      `Turn it down or re-limit. Platforms will normalize it down anyway, and over-limiting to be loud costs punch.`);
  } else {
    add('good', 'Loudness is on target', `${stats.loudness.integrated.toFixed(1)} LUFS vs target ${target} LUFS.`);
  }

  /* clipping / true peak */
  if(stats.clipped > 0)
    add('bad', `${stats.clipped} clipped sample${stats.clipped > 1 ? 's' : ''} detected`, 'Recording hit 0 dBFS. Gain-stage down and re-record, or accept the distortion.');
  if(stats.truePeak > 0.891) // > -1 dBTP
    add('bad', `True peak ${db20(stats.truePeak).toFixed(1)} dBTP`, 'Too hot. Set your limiter ceiling to −1 dBTP minimum.');
  else if(stats.truePeak > 0.977) add('warn', 'True peak above −0.2 dBTP', 'Leave at least −1 dBTP of headroom.');

  /* dynamics */
  if(stats.crestDb > P.crestMax + 5)
    add('warn', `Very dynamic — crest factor ${stats.crestDb.toFixed(1)} dB`, 'Level it first: volume automation or a rider plugin, then compress. Compressing this much at once will pump.');
  else if(stats.crestDb > P.crestMax)
    add('info', `Crest factor ${stats.crestDb.toFixed(1)} dB`, 'Some compression/leveling still needed to lock the narration in place.');
  else if(stats.crestDb < 7)
    add('warn', `Low crest factor (${stats.crestDb.toFixed(1)} dB)`, 'Sounds heavily squashed — some life may be lost. Ease off limiting if possible.');
  else
    add('good', `Healthy dynamics — crest ${stats.crestDb.toFixed(1)} dB`, 'Good balance between impact and control.');

  if(stats.loudness.lra > P.lraMax)
    add('warn', `Loudness range ${stats.loudness.lra.toFixed(1)} LU`, 'Big level swings between phrases. Ride the automation before compressing.');
  else if(stats.loudness.lra > 0.5)
    add('good', `Consistent delivery — LRA ${stats.loudness.lra.toFixed(1)} LU`, 'Phrases sit at a steady level. Easy to glue.');

  /* noise floor */
  if(stats.noiseFloorDb > P.noiseWarn)
    add('bad', `High noise floor (${stats.noiseFloorDb.toFixed(0)} dBFS)`, 'Room tone/hiss will get louder after compression. Use restoration (denoise) or a gate, and treat the room for the next take.');
  else if(stats.noiseFloorDb > P.noiseWarn - 8)
    add('info', `Noise floor ${stats.noiseFloorDb.toFixed(0)} dBFS`, 'Acceptable, but a light denoise before heavy compression keeps it clean.');
  else
    add('good', `Clean noise floor (${stats.noiseFloorDb.toFixed(0)} dBFS)`, 'Quiet recording — no cleanup needed.');

  /* tonal zones */
  const sub = zget('Sub'), chest = zget('Chest'), mud = zget('Mud'),
        pres = zget('Presence'), sib = zget('Sibilance'), air = zget('Air');
  const hpfRec = f => Math.max(40, Math.min(80, Math.round((f + 15) / 10) * 10));
  const rumble = stats.rumbleEvents || [];
  const constantRumble = rumble.find(e => e.dur > stats.duration * 0.5);
  if(constantRumble){
    add('bad', `Constant rumble at ~${Math.round(constantRumble.f)} Hz`,
      `It runs under ${Math.round(constantRumble.dur / stats.duration * 100)}% of the recording (room tone, AC, fan or traffic). Set a high-pass filter at ~${hpfRec(constantRumble.f)} Hz${presetKey === 'narration' ? ' — narration fundamentals sit above 80 Hz, so this will not thin your voice' : ''}.`);
  } else if(rumble.length){
    const dom = rumble.reduce((a, b) => (b.str > a.str ? b : a), rumble[0]);
    const times = rumble.slice(0, 3).map(e => fmtTime(e.t)).join(', ');
    add('warn', `${rumble.length} rumble event${rumble.length > 1 ? 's' : ''} detected (${Math.round(dom.f)} Hz)`,
      `Mic bumps / plosive thumps / vibrations at ${times}${rumble.length > 3 ? '…' : ''} — marked ▼ on the waveform. High-pass at ~${hpfRec(dom.f)} Hz, and edit out the worst hits manually.`);
  } else if(sub.devPink > 6){
    add('warn', `Excess sub energy (${fmtDb(sub.devPink)} dB vs tilt)`, 'High-pass at 50–60 Hz to remove rumble and plosive thumps.');
  } else {
    add('good', 'No rumble detected', 'The 20–80 Hz region is clean — no high-pass urgently needed.');
  }
  if(chest.devPink < P.chestWarn)
    add(presetKey === 'narration' ? 'warn' : 'info', `Thin chest register (${fmtDb(chest.devPink)} dB)`,
      presetKey === 'narration'
        ? 'The KGF depth lives here. Boost 80–150 Hz with a Pultec-style EQ, add saturation, or record closer to the mic for proximity effect.'
        : 'Low end is lighter than the pink-tilt reference.');
  else if(chest.devPink > 6)
    add('info', `Heavy chest register (${fmtDb(chest.devPink)} dB)`, 'Great for the deep style — just watch for boominess around 100 Hz.');
  if(mud.devPink > P.mudWarn)
    add('warn', `Boxy / muddy (${fmtDb(mud.devPink)} dB in 300–500 Hz)`, 'Cut 2–4 dB around 300–500 Hz to open up the voice.');
  if(pres.devPink < P.presWarn)
    add('warn', `Lacking presence (${fmtDb(pres.devPink)} dB in 2–5 kHz)`, 'Boost 2.5–4 kHz slightly — this is where authority and intelligibility come from.');
  else if(pres.devPink > 6)
    add('info', `Forward presence (${fmtDb(pres.devPink)} dB)`, 'Can sound harsh at high volume — tame 3–5 kHz if it fatigues.');
  if(sib.devPink > P.sibWarn)
    add('warn', `Sibilant top end (${fmtDb(sib.devPink)} dB in 5–9 kHz)`, `De-ess after compression/saturation${stats.sibEvents.length ? ' — see the ' + stats.sibEvents.length + ' marked hits below' : ''}.`);
  if(air.devPink < P.airNote)
    add('info', 'Dark top end', 'Very little air above 9 kHz. For the KGF narration style this actually fits — only add air if the voice feels closed in.');

  /* sibilance count */
  if(stats.sibEvents.length > 8)
    add('warn', `${stats.sibEvents.length} sibilance hits detected`, 'That is a lot of sharp "ess" moments — a de-esser is strongly recommended.');

  /* stereo */
  if(stats.isMono)
    add('good', 'Mono file — correct for narration', 'Narrators should sit dead center. Keep it mono through the chain.');
  else if(stats.correlation < 0.6)
    add('warn', `Low L/R correlation (${stats.correlation.toFixed(2)})`, 'Stereo width on a voice risks mono-compatibility issues. Collapse toward mono for narration.');
  else if(!stats.isMono)
    add('info', `Stereo file, correlation ${stats.correlation.toFixed(2)}`, 'Fine, but narration is usually summed to mono eventually.');

  if(!out.some(s => s.sev === 'bad' || s.sev === 'warn'))
    add('good', 'No major problems found', 'This recording is in good shape — focus on taste and tone.');
  return out;
}

/* ============================================================
   RENDERING
   ============================================================ */
function setupCanvas(c){
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  c.width = Math.max(10, Math.round(w * dpr));
  c.height = Math.max(10, Math.round(h * dpr));
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [ctx, w, h];
}

function buildWavePeaks(L, R, cols){
  const n = L.length;
  const min = new Float32Array(cols), max = new Float32Array(cols);
  const step = n / cols;
  for(let cIdx = 0; cIdx < cols; cIdx++){
    const a = Math.floor(cIdx * step), b = Math.min(n, Math.max(a + 1, Math.floor((cIdx + 1) * step)));
    let mn = 0, mx = 0;
    // sample at most ~64 points per column for speed
    const st = Math.max(1, Math.floor((b - a) / 64));
    for(let j = a; j < b; j += st){
      const v = (L[j] + R[j]) / 2;
      if(v < mn) mn = v;
      if(v > mx) mx = v;
    }
    min[cIdx] = mn; max[cIdx] = mx;
  }
  return { min, max, cols };
}

function drawWaveform(){
  if(!curBuf || !wavePeaks) return;
  const c = $('waveCanvas');
  const [ctx, w, h] = setupCanvas(c);
  ctx.clearRect(0, 0, w, h);
  // bg
  ctx.fillStyle = '#0e1118'; ctx.fillRect(0, 0, w, h);
  const { min, max, cols } = wavePeaks;
  const mid = h / 2, amp = (h / 2 - 6) / Math.max(0.001, Math.max(...Array.from(max).slice(0, cols))); // scale to peak
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#ffc862'); grad.addColorStop(0.5, '#f5a623'); grad.addColorStop(1, '#8a5a10');
  ctx.fillStyle = grad;
  for(let x = 0; x < cols && x < w; x++){
    const y1 = mid - max[x] * amp, y2 = mid - min[x] * amp;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
  // sibilance markers (red ▲ top)
  if(mainStats && mainStats.sibEvents.length){
    ctx.fillStyle = '#ff5d5d';
    for(const ev of mainStats.sibEvents){
      const x = ev.t / mainStats.duration * w;
      ctx.beginPath();
      ctx.moveTo(x, 2); ctx.lineTo(x - 4, 10); ctx.lineTo(x + 4, 10);
      ctx.closePath(); ctx.fill();
    }
  }
  // rumble markers (orange ▼ bottom, spans event duration)
  if(mainStats && mainStats.rumbleEvents.length){
    ctx.fillStyle = '#e07b39';
    for(const ev of mainStats.rumbleEvents){
      const x1 = ev.t / mainStats.duration * w;
      const x2 = Math.max(x1 + 3, ev.end / mainStats.duration * w);
      ctx.fillRect(x1, h - 4, x2 - x1, 3);
      ctx.beginPath();
      ctx.moveTo(x1, h - 4); ctx.lineTo(x1 - 4, h - 12); ctx.lineTo(x1 + 4, h - 12);
      ctx.closePath(); ctx.fill();
    }
  }
  // playhead
  if(playing || playOffset > 0){
    const x = playOffset / curBuf.duration * w;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
}

const FMIN = 20, FMAX = 20000;
const fx = (f, w) => Math.log(f / FMIN) / Math.log(FMAX / FMIN) * w;

function drawSpectrum(refDraw){
  if(!mainStats || !mainStats.spec) return;
  const c = $('specCanvas');
  const [ctx, w, h] = setupCanvas(c);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0e1118'; ctx.fillRect(0, 0, w, h);
  const { binDb, binHz, nBins } = mainStats.spec;
  // y-range relative to loudest bin
  let top = -120;
  for(let k = 2; k < nBins; k++) if(binDb[k] > top) top = binDb[k];
  const yMax = top + 4, yMin = yMax - 72;
  const fy = d => h - ((d - yMin) / (yMax - yMin)) * h;
  // zone shading
  for(const z of ZONES){
    const x1 = fx(z.from, w), x2 = fx(Math.min(z.to, FMAX), w);
    ctx.fillStyle = z.col + '10';
    ctx.fillRect(x1, 0, x2 - x1, h);
    ctx.fillStyle = z.col + '99';
    ctx.font = '10px sans-serif';
    ctx.fillText(z.name, x1 + 4, 12);
  }
  // grid
  ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.fillStyle = '#5a6072'; ctx.font = '10px sans-serif';
  for(const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]){
    const x = fx(f, w);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.fillText(f >= 1000 ? (f / 1000) + 'k' : f, x + 3, h - 5);
  }
  for(let d = yMax - 12; d > yMin; d -= 12){
    const y = fy(d);
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.fillStyle = '#5a6072';
    ctx.fillText(d.toFixed(0) + ' dB', 4, y - 3);
  }
  // pink tilt reference (matched at 500 Hz)
  const at500 = binDb[Math.max(2, Math.round(500 / binHz))];
  ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(180,190,210,.55)'; ctx.lineWidth = 1;
  ctx.beginPath();
  let started = false;
  for(let x = 0; x < w; x += 2){
    const f = FMIN * Math.pow(FMAX / FMIN, x / w);
    const ref = at500 + 10 * Math.log10(500 / f);
    const y = fy(ref);
    if(!started){ ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke(); ctx.setLineDash([]);
  // reference track curve
  if(refStats && refStats.spec){
    drawSpecCurve(ctx, refStats.spec, w, h, fy, 'rgba(90,176,255,.85)', [6, 4], refStats.shiftDb || 0);
  }
  // main curve
  drawSpecCurve(ctx, mainStats.spec, w, h, fy, '#f5a623', [], 0, true);
}

function drawSpecCurve(ctx, spec, w, h, fy, color, dash, shiftDb, fill){
  const { binDb, binHz, nBins } = spec;
  ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.setLineDash(dash);
  ctx.beginPath();
  let started = false;
  const firstX = new Array(w + 1).fill(null);
  for(let k = 2; k < nBins; k++){
    const f = k * binHz;
    if(f < FMIN || f > FMAX) continue;
    const x = Math.round(fx(f, w));
    const d = binDb[k] + shiftDb;
    if(firstX[x] === null || d > firstX[x]) firstX[x] = d;
  }
  let last = null;
  for(let x = 0; x <= w; x++){
    if(firstX[x] === null) continue;
    const y = fy(firstX[x]);
    if(!started){ ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    last = [x, y];
  }
  ctx.stroke();
  if(fill && started && last){
    ctx.lineTo(last[0], h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = 'rgba(245,166,35,.08)'; ctx.fill();
  }
  ctx.setLineDash([]);
}

function renderBands(){
  const el = $('bandList');
  el.innerHTML = '';
  if(!mainStats) return;
  const maxShare = Math.max(...mainStats.zones.map(z => z.share), 1e-9);
  for(const z of mainStats.zones){
    const devCls = Math.abs(z.devPink) <= 3 ? 'dev-ok' : (Math.abs(z.devPink) <= 6 ? 'dev-warn' : 'dev-bad');
    const row = document.createElement('div');
    row.className = 'band-row';
    row.innerHTML = `
      <div class="band-name">${z.name}<small>${z.from >= 1000 ? z.from / 1000 + 'k' : z.from}–${z.to >= 1000 ? z.to / 1000 + 'k' : z.to} Hz · ${z.tip}</small></div>
      <div class="band-bar"><div style="width:${Math.max(2, z.share / maxShare * 100).toFixed(1)}%;background:${z.col}"></div></div>
      <div class="band-level">${z.levelDb.toFixed(1)} dB</div>
      <div class="band-dev ${devCls}">${fmtDb(z.devPink)} dB</div>`;
    el.appendChild(row);
  }
}

function renderMeters(){
  const s = mainStats;
  const target = parseFloat($('targetSel').value);
  $('lufsInt').textContent = isFinite(s.loudness.integrated) ? s.loudness.integrated.toFixed(1) : '—';
  const diff = target - s.loudness.integrated;
  $('lufsDelta').textContent = isFinite(diff) ? `target ${target} · Δ ${fmtDb(diff)} dB` : 'target —';
  $('lufsShort').textContent = isFinite(s.loudness.shortMax) ? s.loudness.shortMax.toFixed(1) : '—';
  $('lra').textContent = s.loudness.lra.toFixed(1);
  $('truePeak').textContent = db20(s.truePeak).toFixed(1);
  $('peakLR').innerHTML = `${db20(s.peakL).toFixed(1)} / ${db20(s.peakR).toFixed(1)}`;
  $('crest').textContent = s.crestDb.toFixed(1);
  $('noiseFloor').textContent = s.noiseFloorDb.toFixed(1);
  $('clipped').textContent = s.clipped;
  $('chFormat').textContent = s.isMono ? 'Mono' : 'Stereo';
  $('corrVal').textContent = s.isMono ? '1.00' : s.correlation.toFixed(2);
  const cf = $('corrFill');
  if(s.isMono){ cf.style.left = '50%'; cf.style.width = '2px'; }
  else {
    const cN = (s.correlation + 1) / 2; // -1..1 → 0..1
    cf.style.left = '50%'; cf.style.width = Math.max(2, (cN - 0.5) * 100) + '%';
    cf.style.background = s.correlation < 0.6 ? 'var(--red)' : 'var(--green)';
  }
  $('widthVal').textContent = s.isMono ? '0' : s.widthPct.toFixed(1);
  const mv = $('monoVerdict');
  if(s.isMono){ mv.innerHTML = '<span style="color:var(--green)">✔ Already mono — perfect for narration.</span>'; }
  else if(s.correlation >= 0.9){ mv.innerHTML = '<span style="color:var(--green)">✔ Excellent mono compatibility.</span>'; }
  else if(s.correlation >= 0.6){ mv.innerHTML = '<span style="color:var(--amber)">△ Mostly safe, check in mono.</span>'; }
  else { mv.innerHTML = '<span style="color:var(--red)">✕ Phase issues likely — collapse toward mono.</span>'; }
}

function renderRumbleList(){
  const el = $('rumbleList');
  el.innerHTML = '';
  if(!mainStats || !mainStats.rumbleEvents.length){
    el.innerHTML = '<span class="dz-sub">No rumble detected in 20–80 Hz — low end is clean. 🎯</span>';
    return;
  }
  const summary = document.createElement('div');
  summary.className = 'dz-sub';
  summary.style.cssText = 'width:100%;margin-bottom:6px';
  const worst = mainStats.rumbleEvents.reduce((a, b) => (b.str > a.str ? b : a));
  summary.textContent = `${mainStats.rumbleEvents.length} event(s) · dominant frequency ≈ ${Math.round(worst.f)} Hz · orange ▼ marks on the waveform`;
  el.appendChild(summary);
  mainStats.rumbleEvents.slice(0, 40).forEach(ev => {
    const chip = document.createElement('span');
    chip.className = 'sib-chip rumble' + (ev.str > -16 ? ' hot' : '');
    chip.innerHTML = `${fmtTime(ev.t)} · <b>${ev.dur.toFixed(1)}s</b> · ~${Math.round(ev.f)} Hz`;
    chip.onclick = () => auditionAt(Math.max(0, ev.t - 0.3));
    el.appendChild(chip);
  });
}

function renderSibList(){
  const el = $('sibList');
  el.innerHTML = '';
  if(!mainStats || !mainStats.sibEvents.length){
    el.innerHTML = '<span class="dz-sub">No significant sibilance detected — nice take. 🎯</span>';
    return;
  }
  mainStats.sibEvents.slice(0, 40).forEach(ev => {
    const chip = document.createElement('span');
    chip.className = 'sib-chip' + (ev.str > -10 ? ' hot' : '');
    chip.innerHTML = `${fmtTime(ev.t)} · <b>${ev.str.toFixed(0)} dB</b>`;
    chip.onclick = () => auditionAt(Math.max(0, ev.t - 0.4));
    el.appendChild(chip);
  });
}

function renderSuggestions(){
  const list = $('suggList');
  list.innerHTML = '';
  if(!mainStats) return;
  const presetKey = $('presetSel').value;
  const target = parseFloat($('targetSel').value);
  $('suggPresetLabel').textContent = PRESETS[presetKey].label;
  const icons = { bad: '✕', warn: '△', good: '✔', info: 'ℹ' };
  for(const s of computeSuggestions(mainStats, presetKey, target)){
    const d = document.createElement('div');
    d.className = 'sugg ' + s.sev;
    d.innerHTML = `<div class="ico">${icons[s.sev]}</div><div><h4>${s.title}</h4><p>${s.text}</p></div>`;
    list.appendChild(d);
  }
}

/* ============================================================
   REFERENCE COMPARE
   ============================================================ */
function drawDelta(){
  if(!mainStats || !refStats) return;
  const c = $('deltaCanvas');
  const [ctx, w, h] = setupCanvas(c);
  ctx.fillStyle = '#0e1118'; ctx.fillRect(0, 0, w, h);
  const mid = h / 2;
  const range = 12; // ±12 dB
  ctx.strokeStyle = 'rgba(255,255,255,.2)';
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
  ctx.fillStyle = '#5a6072'; ctx.font = '10px sans-serif';
  ctx.fillText('+6 dB you', 6, mid - range / 2 * (h / 2 / range) - 4);
  ctx.fillText('−6 dB reference', 6, mid + range / 2 * (h / 2 / range) + 10);
  const A = mainStats.spec, B = refStats.spec;
  const shift = refStats.shiftDb || 0;
  ctx.beginPath();
  let started = false;
  for(let x = 0; x < w; x += 2){
    const f = FMIN * Math.pow(FMAX / FMIN, x / w);
    const ka = Math.max(2, Math.round(f / A.binHz));
    const kb = Math.max(2, Math.round(f / B.binHz));
    if(ka >= A.nBins || kb >= B.nBins) continue;
    let d = A.binDb[ka] - (B.binDb[kb] + shift);
    d = Math.max(-range, Math.min(range, d));
    const y = mid - d / range * (h / 2 - 4);
    if(!started){ ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#f5a623'; ctx.lineWidth = 1.5; ctx.stroke();
}

function renderReference(){
  if(!refStats){
    $('refEmpty').classList.remove('hidden');
    $('refResult').classList.add('hidden');
    return;
  }
  $('refEmpty').classList.add('hidden');
  $('refResult').classList.remove('hidden');
  drawDelta();
  const f = $('refFindings');
  f.innerHTML = '';
  const findings = [];
  const zd = name => {
    const a = mainStats.zones.find(z => z.name === name);
    const b = refStats.zones.find(z => z.name === name);
    return a.levelDb - b.levelDb;
  };
  const chestD = zd('Chest'), mudD = zd('Mud'), presD = zd('Presence'), sibD = zd('Sibilance'), airD = zd('Air');
  findings.push(chestD < -1.5
    ? `<b>Chest/depth:</b> reference has ${(-chestD).toFixed(1)} dB more 60–150 Hz energy → boost low end (Pultec-style at 100 Hz), add saturation, or a sub-octave layer.`
    : chestD > 1.5
      ? `<b>Chest/depth:</b> you have ${chestD.toFixed(1)} dB more low end than the reference — good depth, watch for boominess.`
      : `<b>Chest/depth:</b> low-end balance is close to the reference. ✔`);
  findings.push(mudD > 2
    ? `<b>Mud:</b> you carry ${mudD.toFixed(1)} dB more 300–500 Hz → cut with EQ to match the reference's clarity.`
    : mudD < -2
      ? `<b>Mud:</b> reference is ${(-mudD).toFixed(1)} dB boxier than you — no action needed.`
      : `<b>Mud:</b> boxiness matches the reference. ✔`);
  findings.push(presD < -2
    ? `<b>Presence:</b> reference is ${(-presD).toFixed(1)} dB more present at 2–5 kHz → add a little bite for authority.`
    : presD > 2
      ? `<b>Presence:</b> you're ${presD.toFixed(1)} dB more present — tame 3–5 kHz if it feels aggressive.`
      : `<b>Presence:</b> clarity matches the reference. ✔`);
  findings.push(sibD > 2.5
    ? `<b>Sibilance:</b> you have ${sibD.toFixed(1)} dB more 5–9 kHz → de-ess to match.`
    : `<b>Sibilance:</b> within range of the reference. ✔`);
  findings.push(airD < -4
    ? `<b>Air:</b> reference is brighter above 9 kHz by ${(-airD).toFixed(1)} dB — optional; dark top end suits the KGF style.`
    : `<b>Air:</b> top end matches. ✔`);
  const lufsD = mainStats.loudness.integrated - refStats.loudness.integrated;
  findings.push(`<b>Loudness:</b> ${Math.abs(lufsD) < 0.5 ? 'same loudness as reference. ✔' : (lufsD > 0 ? `you are ${lufsD.toFixed(1)} dB louder` : `reference is ${(-lufsD).toFixed(1)} dB louder`) + ' — plan limiting accordingly.'}`);
  for(const t of findings){
    const d = document.createElement('div');
    d.className = 'ref-finding';
    d.innerHTML = t;
    f.appendChild(d);
  }
  drawSpectrum();
}

/* ============================================================
   FIX PREVIEW (live chain: HPF → mud cut → presence → sib tame → comp → gain → limiter)
   ============================================================ */
let fxNodes = null;
function ensureFxChain(){
  ensureCtx();
  if(fxNodes) return fxNodes;
  const c = audioCtx;
  const hpf = c.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 10; hpf.Q.value = 0.707;
  const mud = c.createBiquadFilter(); mud.type = 'peaking'; mud.frequency.value = 400; mud.Q.value = 1.0; mud.gain.value = 0;
  const pres = c.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3000; pres.Q.value = 0.9; pres.gain.value = 0;
  const sib = c.createBiquadFilter(); sib.type = 'highshelf'; sib.frequency.value = 6000; sib.gain.value = 0;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = 0; comp.knee.value = 8; comp.ratio.value = 1; comp.attack.value = 0.004; comp.release.value = 0.15;
  const outGain = c.createGain(); outGain.gain.value = 1;
  const limit = c.createDynamicsCompressor();
  limit.threshold.value = 0; limit.knee.value = 0; limit.ratio.value = 1; limit.attack.value = 0.001; limit.release.value = 0.08;
  hpf.connect(mud); mud.connect(pres); pres.connect(sib); sib.connect(comp); comp.connect(outGain); outGain.connect(limit); limit.connect(c.destination);
  fxNodes = { input: hpf, hpf, mud, pres, sib, comp, outGain, limit };
  return fxNodes;
}

function fxValues(){
  const target = parseFloat($('targetSel').value);
  const s = mainStats;
  const worst = (s.rumbleEvents || []).reduce((a, b) => (!a || b.str > a.str ? b : a), null);
  const hpf = worst ? Math.max(40, Math.min(80, Math.round((worst.f + 15) / 10) * 10)) : 60;
  const thr = Math.max(-40, Math.min(-6, s.rmsDb + 2));
  const diff = target - s.loudness.integrated;
  const gain = Math.max(0.25, Math.min(2.8, Math.pow(10, diff / 20)));
  return { hpf, thr, gain, diff };
}

function updateFx(){
  if(!audioCtx || !fxNodes) return;
  const fx = fxNodes, now = audioCtx.currentTime, tc = 0.03;
  const on = $('fxEnable') && $('fxEnable').checked;
  const v = mainStats ? fxValues() : { hpf: 60, thr: -20, gain: 1 };
  fx.hpf.frequency.setTargetAtTime(on && $('fxHpf').checked ? v.hpf : 10, now, tc);
  fx.mud.gain.setTargetAtTime(on && $('fxMud').checked ? -3 : 0, now, tc);
  fx.pres.gain.setTargetAtTime(on && $('fxPres').checked ? 2.5 : 0, now, tc);
  fx.sib.gain.setTargetAtTime(on && $('fxSib').checked ? -5 : 0, now, tc);
  const lvl = on && $('fxLevel').checked;
  fx.comp.threshold.setTargetAtTime(lvl ? v.thr : 0, now, tc);
  fx.comp.ratio.setTargetAtTime(lvl ? 4 : 1, now, tc);
  fx.outGain.gain.setTargetAtTime(lvl ? v.gain : 1, now, tc);
  fx.limit.threshold.setTargetAtTime(lvl ? -1.5 : 0, now, tc);
  fx.limit.ratio.setTargetAtTime(lvl ? 20 : 1, now, tc);
  if($('fxInfo')){
    $('fxInfo').textContent = mainStats
      ? `HPF ${v.hpf} Hz · mud −3 dB @400 Hz · presence +2.5 dB @3 kHz · sibilance −5 dB >6 kHz · comp ${v.thr.toFixed(0)} dBFS / 4:1 · makeup ${fmtDb(20 * Math.log10(v.gain))} dB (→ ${$('targetSel').value} LUFS)`
      : '';
  }
}

/* ============================================================
   PLAYBACK
   ============================================================ */
function stopSrc(){
  if(playSrc){ try{ playSrc.onended = null; playSrc.stop(); }catch(e){} playSrc = null; }
}
function currentPos(){
  return playing ? Math.min(curBuf.duration, playOffset + (audioCtx.currentTime - playStartedAt)) : playOffset;
}
function play(from){
  ensureCtx();
  stopSrc();
  playSrc = audioCtx.createBufferSource();
  playSrc.buffer = curBuf;
  playSrc.connect(ensureFxChain().input);
  updateFx();
  playSrc.onended = () => {
    if(playing){
      playing = false;
      playOffset = 0;
      updatePlayBtn();
      drawWaveform();
      $('timeLabel').textContent = `${fmtTime(0)} / ${fmtTime(curBuf.duration)}`;
    }
  };
  playSrc.start(0, from);
  playStartedAt = audioCtx.currentTime;
  playOffset = from;
  playing = true;
  updatePlayBtn();
  loopPlayhead();
}
function pause(){
  playOffset = currentPos();
  playing = false;
  stopSrc();
  updatePlayBtn();
  drawWaveform();
}
function loopPlayhead(){
  if(!playing) return;
  playOffset = currentPos();
  drawWaveform();
  $('timeLabel').textContent = `${fmtTime(playOffset)} / ${fmtTime(curBuf.duration)}`;
  rafId = requestAnimationFrame(loopPlayhead);
}
function auditionAt(t){ play(t); }
function updatePlayBtn(){ $('playBtn').textContent = playing ? '❚❚ Pause' : '▶ Play'; }

/* ============================================================
   FILE LOADING
   ============================================================ */
function setProgress(pct, label){
  $('progressWrap').classList.remove('hidden');
  $('progressFill').style.width = (pct * 100).toFixed(0) + '%';
  $('progressPct').textContent = (pct * 100).toFixed(0) + '%';
  if(label) $('progressLabel').textContent = label;
}

async function loadFile(file, isRef){
  try{
    ensureCtx();
    if(!isRef){
      setProgress(0.01, 'Reading file…');
      $('results').classList.add('hidden');
      refStats = null;
    } else setProgress(0.01, 'Analyzing reference…');
    const ab = await file.arrayBuffer();
    setProgress(isRef ? 0.05 : 0.04, 'Decoding audio…');
    const buf = await audioCtx.decodeAudioData(ab);
    const stats = await analyzeAudio(buf, (p, label) => setProgress(isRef ? 0.05 + p * 0.9 : p, label));
    if(!isRef){
      curBuf = buf;
      mainStats = stats;
      playOffset = 0; playing = false; stopSrc(); updatePlayBtn();
      const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0);
      wavePeaks = buildWavePeaks(buf.getChannelData(0), R, Math.max(300, $('waveCanvas').clientWidth || 800));
      $('fileName').textContent = file.name;
      $('fileMeta').textContent = `${fmtTime(buf.duration)} · ${buf.sampleRate} Hz · ${buf.numberOfChannels}ch`;
      $('results').classList.remove('hidden');
      $('progressWrap').classList.add('hidden');
      renderMeters(); renderBands(); renderRumbleList(); renderSibList(); renderSuggestions();
      drawWaveform(); drawSpectrum();
      if(fxNodes || audioCtx) updateFx();
      else if($('fxInfo')) $('fxInfo').textContent = 'Analysis done — toggle "Preview ON" and press Play to A/B the suggested fixes.';
      if(refStats){ refStats.shiftDb = mainStats.loudness.integrated - refStats.loudness.integrated; renderReference(); }
      $('timeLabel').textContent = `${fmtTime(0)} / ${fmtTime(buf.duration)}`;
      $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      refStats = stats;
      refStats.shiftDb = mainStats.loudness.integrated - refStats.loudness.integrated;
      $('refName').textContent = file.name;
      $('progressWrap').classList.add('hidden');
      renderReference();
    }
  }catch(err){
    $('progressWrap').classList.add('hidden');
    alert('Could not analyze this file: ' + err.message + '\nUse an audio file (WAV/MP3/FLAC/M4A/OGG).');
    console.error(err);
  }
}

/* ---------- WAV export with embedded markers (Cubase-importable) ---------- */
function collectMarkers(s){
  const ms = [];
  for(const ev of s.rumbleEvents || []) ms.push({ t: ev.t, label: `RUMBLE ~${Math.round(ev.f)}Hz ${ev.dur.toFixed(1)}s` });
  for(const ev of s.sibEvents || []) ms.push({ t: ev.t, label: `SIBILANCE ${Math.round(ev.str)}dB` });
  for(const ct of (s.clipTimes || [])) ms.push({ t: ct, label: 'CLIPPING' });
  ms.sort((a, b) => a.t - b.t);
  return ms;
}

function buildMarkedWav(buf, markers){
  const nCh = Math.min(buf.numberOfChannels, 2);
  const sr = buf.sampleRate, n = buf.length;
  const L = buf.getChannelData(0);
  const R = nCh > 1 ? buf.getChannelData(1) : L;
  const blockAlign = nCh * 2;
  const dataSize = n * blockAlign;
  const ms = markers.slice(0, 99).map((m, i) => ({
    id: i + 1,
    pos: Math.min(n - 1, Math.max(0, Math.round(m.t * sr))),
    label: String(m.label || ('MARK ' + (i + 1))).replace(/[^\x20-\x7E]/g, '').slice(0, 60),
  }));
  const cueSize = 4 + ms.length * 24;
  let listSize = 4; // 'adtl'
  for(const m of ms){
    const len = m.label.length + 1; // + null terminator
    listSize += 8 + 4 + len + (len & 1);
  }
  const total = 4 + (8 + 16) + (8 + dataSize) + (8 + cueSize) + (8 + listSize);
  const ab = new ArrayBuffer(8 + total);
  const dv = new DataView(ab);
  let o = 0;
  const ws = s => { for(let i = 0; i < s.length; i++) dv.setUint8(o++, s.charCodeAt(i)); };
  const u32 = v => { dv.setUint32(o, v, true); o += 4; };
  const u16 = v => { dv.setUint16(o, v, true); o += 2; };
  const i16 = v => { dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(v * 32767))), true); o += 2; };
  ws('RIFF'); u32(total); ws('WAVE');
  ws('fmt '); u32(16); u16(1); u16(nCh); u32(sr); u32(sr * blockAlign); u16(blockAlign); u16(16);
  ws('data'); u32(dataSize);
  for(let i = 0; i < n; i++){
    i16(L[i]);
    if(nCh > 1) i16(R[i]);
  }
  ws('cue '); u32(cueSize); u32(ms.length);
  for(const m of ms){ u32(m.id); u32(m.pos); ws('data'); u32(0); u32(0); u32(m.pos); }
  ws('LIST'); u32(listSize); ws('adtl');
  for(const m of ms){
    const len = m.label.length + 1;
    const padded = len + (len & 1);
    ws('labl'); u32(4 + padded); u32(m.id);
    for(let i = 0; i < m.label.length; i++) dv.setUint8(o++, m.label.charCodeAt(i));
    dv.setUint8(o++, 0);
    if(padded > len) dv.setUint8(o++, 0);
  }
  return ab;
}

function exportMarkedWav(){
  if(!curBuf || !mainStats) return;
  const ab = buildMarkedWav(curBuf, collectMarkers(mainStats));
  const blob = new Blob([ab], { type: 'audio/wav' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = ($('fileName').textContent || 'audio').replace(/\.[^.]+$/, '') + '_marked.wav';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ============================================================
   REPORT EXPORT
   ============================================================ */
function exportReport(){
  if(!mainStats) return;
  const s = mainStats;
  const target = parseFloat($('targetSel').value);
  const presetKey = $('presetSel').value;
  let t = `MIXLENS ANALYSIS REPORT\n=======================\n`;
  t += `Preset: ${PRESETS[presetKey].label} · Target: ${target} LUFS\n\n`;
  t += `Integrated loudness: ${s.loudness.integrated.toFixed(1)} LUFS (Δ ${fmtDb(target - s.loudness.integrated)} dB)\n`;
  t += `Short-term max: ${s.loudness.shortMax.toFixed(1)} LUFS · LRA: ${s.loudness.lra.toFixed(1)} LU\n`;
  t += `True peak: ${db20(s.truePeak).toFixed(1)} dBTP · Peaks L/R: ${db20(s.peakL).toFixed(1)}/${db20(s.peakR).toFixed(1)} dBFS\n`;
  t += `Crest factor: ${s.crestDb.toFixed(1)} dB · Noise floor: ${s.noiseFloorDb.toFixed(1)} dBFS · Clipped: ${s.clipped}\n`;
  t += `Format: ${s.isMono ? 'Mono' : 'Stereo'} · Corr: ${s.correlation.toFixed(2)} · Width: ${s.widthPct.toFixed(1)}%\n\n`;
  t += `BAND BALANCE (vs pink tilt)\n---------------------------\n`;
  for(const z of s.zones) t += `${z.name.padEnd(10)} ${z.levelDb.toFixed(1).padStart(7)} dBFS · ${fmtDb(z.devPink).padStart(6)} dB\n`;
  t += `\nSUGGESTIONS\n-----------\n`;
  for(const sg of computeSuggestions(s, presetKey, target)) t += `[${sg.sev.toUpperCase()}] ${sg.title}\n    ${sg.text}\n`;
  if(s.rumbleEvents && s.rumbleEvents.length){
    t += `\nRUMBLE EVENTS: ${s.rumbleEvents.length}\n`;
    s.rumbleEvents.slice(0, 20).forEach(ev => t += `  ${fmtTime(ev.t)} · ${ev.dur.toFixed(1)}s · ~${Math.round(ev.f)} Hz\n`);
  }
  if(s.sibEvents.length){
    t += `\nSIBILANCE HITS: ${s.sibEvents.length}\n`;
    s.sibEvents.slice(0, 20).forEach(ev => t += `  ${fmtTime(ev.t)} (${ev.str.toFixed(0)} dB)\n`);
  }
  const blob = new Blob([t], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mixlens-report.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================================================
   WIRING
   ============================================================ */
const dz = $('dropZone');
dz.addEventListener('click', e => {
  if(e.target === $('fileInput')) return; // avoid recursion from programmatic click
  $('fileInput').click();
});
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag');
  if(e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0], false);
});
$('fileInput').addEventListener('change', e => { if(e.target.files.length) loadFile(e.target.files[0], false); });

$('refBtn').addEventListener('click', () => $('refInput').click());
$('refInput').addEventListener('change', e => { if(e.target.files.length && mainStats) loadFile(e.target.files[0], true); });
$('refClear').addEventListener('click', () => { refStats = null; renderReference(); drawSpectrum(); });

$('presetSel').addEventListener('change', () => { if(mainStats){ renderSuggestions(); renderBands(); } });
$('targetSel').addEventListener('change', () => { if(mainStats){ renderSuggestions(); renderMeters(); updateFx(); } });

$('exportMarkedBtn').addEventListener('click', exportMarkedWav);
['fxEnable', 'fxHpf', 'fxMud', 'fxPres', 'fxSib', 'fxLevel'].forEach(id => $(id).addEventListener('change', updateFx));

$('playBtn').addEventListener('click', () => {
  if(!curBuf) return;
  if(playing) pause(); else play(playOffset);
});
$('waveCanvas').addEventListener('click', e => {
  if(!curBuf) return;
  const rect = e.target.getBoundingClientRect();
  const t = (e.clientX - rect.left) / rect.width * curBuf.duration;
  if(playing){ play(t); } else { playOffset = t; drawWaveform(); $('timeLabel').textContent = `${fmtTime(t)} / ${fmtTime(curBuf.duration)}`; }
});
$('exportBtn').addEventListener('click', exportReport);

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if(curBuf){
      const R = curBuf.numberOfChannels > 1 ? curBuf.getChannelData(1) : curBuf.getChannelData(0);
      wavePeaks = buildWavePeaks(curBuf.getChannelData(0), R, Math.max(300, $('waveCanvas').clientWidth || 800));
      drawWaveform(); drawSpectrum(); drawDelta();
    }
  }, 150);
});
