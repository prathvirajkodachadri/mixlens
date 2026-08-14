/* ============================================================
   VoxLens — vox-dsp.js
   Pure-JS vocal chain DSP (XVox-style all-in-one):
     GATE → DE-ESS → TONE EQ → COMPRESSOR → HEAT (saturator) → OUT GAIN → LIMITER
   Stereo-linked detection, per-channel filtering.
   UMD: browser / AudioWorklet global (`VoxDSP`), Node (`require`).
   No dependencies, no GC churn in the audio thread.
   ============================================================ */
(function (root, factory) {
  const M = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
  root.VoxDSP = M; // registers globalThis.VoxDSP inside the worklet scope too
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const clamp = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);
  const dbToLin = db => Math.pow(10, db / 20);
  const linToDb = x => 20 * Math.log10(x + 1e-12);
  // one-pole coefficient for a time constant in ms
  const coefMs = (ms, fs) => Math.exp(-1 / (Math.max(0.01, ms) * 0.001 * fs));

  /* ---------------- Biquad (RBJ audio EQ cookbook) ---------------- */
  class Biquad {
    constructor() {
      this.z1 = 0; this.z2 = 0;
      this.setPassthrough();
    }
    setPassthrough() {
      this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    }
    reset() { this.z1 = 0; this.z2 = 0; }
    /**
     * Update coefficients WITHOUT touching filter state (zipper-free swaps).
     * type: lowpass | highpass | bandpass(0 dB peak) | peaking | lowshelf | highshelf | passthrough
     */
    set(type, fs, f0, Q, gainDb) {
      if (type === 'passthrough') { this.setPassthrough(); return; }
      const A = Math.pow(10, (gainDb || 0) / 40);
      const w0 = 2 * Math.PI * clamp(f0, 10, fs * 0.49) / fs;
      const cosw = Math.cos(w0), sinw = Math.sin(w0);
      const alpha = sinw / (2 * Math.max(0.001, Q));
      let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
      switch (type) {
        case 'lowpass':
          b0 = (1 - cosw) / 2; b1 = 1 - cosw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha; break;
        case 'highpass':
          b0 = (1 + cosw) / 2; b1 = -(1 + cosw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha; break;
        case 'bandpass': // constant 0 dB peak gain (skirt = alpha) — used for the de-esser detector
          b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha; break;
        case 'peaking':
          b0 = 1 + alpha * A; b1 = -2 * cosw; b2 = 1 - alpha * A;
          a0 = 1 + alpha / A; a1 = -2 * cosw; a2 = 1 - alpha / A; break;
        case 'lowshelf': {
          const s = Math.sqrt(A);
          b0 = A * ((A + 1) - (A - 1) * cosw + 2 * s * alpha);
          b1 = 2 * A * ((A - 1) - (A + 1) * cosw);
          b2 = A * ((A + 1) - (A - 1) * cosw - 2 * s * alpha);
          a0 = (A + 1) + (A - 1) * cosw + 2 * s * alpha;
          a1 = -2 * ((A - 1) + (A + 1) * cosw);
          a2 = (A + 1) + (A - 1) * cosw - 2 * s * alpha; break;
        }
        case 'highshelf': {
          const s = Math.sqrt(A);
          b0 = A * ((A + 1) + (A - 1) * cosw + 2 * s * alpha);
          b1 = -2 * A * ((A - 1) + (A + 1) * cosw);
          b2 = A * ((A + 1) + (A - 1) * cosw - 2 * s * alpha);
          a0 = (A + 1) - (A - 1) * cosw + 2 * s * alpha;
          a1 = 2 * ((A - 1) - (A + 1) * cosw);
          a2 = (A + 1) - (A - 1) * cosw - 2 * s * alpha; break;
        }
        default: this.setPassthrough(); return;
      }
      this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    }
    proc(x) {
      const y = this.b0 * x + this.z1;
      this.z1 = this.b1 * x - this.a1 * y + this.z2;
      this.z2 = this.b2 * x - this.a2 * y;
      return y;
    }
  }

  /* ---------------- Peak envelope follower (attack on rise, release on fall) ---------------- */
  class Detector {
    constructor(fs, atkMs, relMs) {
      this.env = 0;
      this.setTimes(fs, atkMs, relMs);
    }
    setTimes(fs, atkMs, relMs) {
      this.atkC = coefMs(atkMs, fs);
      this.relC = coefMs(relMs, fs);
    }
    proc(x) { // x = |signal| >= 0
      const c = x > this.env ? this.atkC : this.relC;
      this.env = c * this.env + (1 - c) * x;
      return this.env;
    }
  }

  /* ---------------- Compressor static curve (soft knee) ----------------
     Returns gain reduction in dB (positive = reduction). */
  function compGrDb(inDb, thrDb, ratio, kneeDb) {
    const over = inDb - thrDb;
    if (kneeDb > 0 && Math.abs(over) <= kneeDb / 2) {
      const x = over + kneeDb / 2;
      return (1 - 1 / ratio) * (x * x) / (2 * kneeDb);
    }
    if (over <= 0) return 0;
    return over * (1 - 1 / ratio);
  }

  /* ---------------- 4x oversampler (for the saturator) ---------------- */
  class Oversampler4 {
    constructor(fs) {
      const fc = Math.min(20000, fs * 0.42);
      this.lpUp = new Biquad(); this.lpUp.set('lowpass', fs * 4, fc, 0.707, 0);
      this.lpDn = new Biquad(); this.lpDn.set('lowpass', fs * 4, fc, 0.707, 0);
      this.prev = 0;
    }
    reset() { this.lpUp.reset(); this.lpDn.reset(); this.prev = 0; }
    /** shape: f(v)->v applied at 4x rate. Returns 1x-rate output for input sample x. */
    proc(x, shape) {
      const p = this.prev;
      let out = 0;
      // linear-interp upsample: positions 1/4, 2/4, 3/4, 4/4 within the (prev -> x) interval
      for (let k = 1; k <= 4; k++) {
        const v = p + (x - p) * (k * 0.25);
        const f = this.lpUp.proc(v);
        out = this.lpDn.proc(shape(f));
      }
      this.prev = x;
      return out;
    }
  }

  /* ---------------- Parameter definitions (single source of truth) ---------------- */
  const PARAM_DEFS = [
    { key: 'bypass',    label: 'Bypass',        min: 0,    max: 1,    def: 0,    type: 'toggle' },

    { key: 'gateOn',    label: 'Gate',          min: 0,    max: 1,    def: 0,    type: 'toggle' },
    { key: 'gateThr',   label: 'Threshold',     min: -90,  max: 0,    def: -55,  unit: 'dB' },
    { key: 'gateRange', label: 'Range',         min: -60,  max: 0,    def: -40,  unit: 'dB' },
    { key: 'gateRel',   label: 'Release',       min: 10,   max: 1000, def: 150,  unit: 'ms', curve: 'log', hint: 'close time' },

    { key: 'dssOn',     label: 'De-Ess',        min: 0,    max: 1,    def: 0,    type: 'toggle' },
    { key: 'dssFreq',   label: 'Freq',          min: 3000, max: 12000, def: 6500, unit: 'Hz', curve: 'log' },
    { key: 'dssThr',    label: 'Threshold',     min: -70,  max: 0,    def: -45,  unit: 'dB' },
    { key: 'dssAmt',    label: 'Amount',        min: 0,    max: 1,    def: 0.6,  unit: 'x100' },

    { key: 'eqOn',      label: 'Tone EQ',       min: 0,    max: 1,    def: 1,    type: 'toggle' },
    { key: 'eqHpf',     label: 'HPF',           min: 20,   max: 400,  def: 80,   unit: 'Hz', curve: 'log' },
    { key: 'eqLow',     label: 'Low',           min: -12,  max: 12,   def: 0,    unit: 'dB' },
    { key: 'eqTone',    label: 'Tone',          min: -8,   max: 8,    def: 0,    unit: 'dB', hint: 'dark ↔ bright tilt' },
    { key: 'eqAir',     label: 'Air',           min: 0,    max: 12,   def: 0,    unit: 'dB' },

    { key: 'cmpOn',     label: 'Compressor',    min: 0,    max: 1,    def: 0,    type: 'toggle' },
    { key: 'cmpThr',    label: 'Threshold',     min: -60,  max: 0,    def: -18,  unit: 'dB' },
    { key: 'cmpRatio',  label: 'Ratio',         min: 1,    max: 20,   def: 3,    unit: ':1' },
    { key: 'cmpAtk',    label: 'Attack',        min: 0.1,  max: 100,  def: 8,    unit: 'ms', curve: 'log' },
    { key: 'cmpRel',    label: 'Release',       min: 20,   max: 1000, def: 150,  unit: 'ms', curve: 'log' },
    { key: 'cmpMake',   label: 'Makeup',        min: -12,  max: 24,   def: 0,    unit: 'dB' },

    { key: 'satOn',     label: 'Heat',          min: 0,    max: 1,    def: 0,    type: 'toggle' },
    { key: 'satDrive',  label: 'Drive',         min: 0,    max: 24,   def: 6,    unit: 'dB' },
    { key: 'satMix',    label: 'Mix',           min: 0,    max: 1,    def: 0.5,  unit: 'x100' },

    { key: 'limOn',     label: 'Limiter',       min: 0,    max: 1,    def: 1,    type: 'toggle' },
    { key: 'limCeil',   label: 'Ceiling',       min: -6,   max: 0,    def: -1,   unit: 'dB' },
    { key: 'outGain',   label: 'Level',         min: -24,  max: 24,   def: 0,    unit: 'dB', hint: 'into limiter' },
  ];
  const PARAM_MAP = {};
  for (const d of PARAM_DEFS) PARAM_MAP[d.key] = d;
  function defaultParams() {
    const p = {};
    for (const d of PARAM_DEFS) p[d.key] = d.def;
    return p;
  }

  /* ============================================================
     VoxChain — the full vocal chain, block processor (in place)
     ============================================================ */
  const MAX_BLOCK = 4096;

  class VoxChain {
    constructor(fs, nCh) {
      this.fs = fs;
      this.nCh = Math.max(1, Math.min(2, nCh || 2));
      this.p = defaultParams();
      this._prevKey = '';   // cheap param-diff for EQ coefficient refreshes

      // per-channel filter state
      this.ch = [];
      for (let c = 0; c < this.nCh; c++) {
        this.ch.push({
          dssShelf: new Biquad(),
          hpf: new Biquad(), low: new Biquad(), tiltLo: new Biquad(), tiltHi: new Biquad(), air: new Biquad(),
          os: new Oversampler4(fs),
          limRing: new Float32Array(this._limLen()),
        });
      }
      // linked detectors
      this.dssBp = new Biquad(); this.dssBp.set('bandpass', fs, 6500, 0.9, 0);
      this.gateDet = new Detector(fs, 1, 80);
      this.dssDet = new Detector(fs, 1, 80);
      this.cmpDet = new Detector(fs, 8, 150);

      this.gateGDb = 0;   // smoothed gate gain (dB)
      this.dssGDb = 0;    // smoothed de-esser reduction (dB, positive)
      this.limG = 1;      // smoothed limiter gain (linear)
      this.limIdx = 0;
      this.limGRing = new Float32Array(this._limLen()).fill(1); // per-sample gain requirement
      this._dssArr = new Float32Array(MAX_BLOCK);
      this.meters = { inPk: 0, outPk: 0, gateGrDb: 0, dssGrDb: 0, cmpGrDb: 0, limGrDb: 0 };
    }

    _limLen() { return Math.max(4, Math.ceil(this.fs * 0.002)); } // 2 ms lookahead

    setParams(p) {
      Object.assign(this.p, p);
      this._syncDerived();
    }

    _syncDerived() {
      const P = this.p, fs = this.fs;
      // static-ish derived values (cheap; run per block, trig only where needed)
      this._gateThrLin = dbToLin(P.gateThr);
      this._gateOpenC = coefMs(5, fs);
      this._gateCloseC = coefMs(P.gateRel, fs);
      this._dssAtkC = coefMs(2, fs);
      this._dssRelC = coefMs(80, fs);
      this._dssMult = P.dssAmt * 4;
      this._cmpMakeLin = dbToLin(P.cmpMake);
      this._outLin = dbToLin(P.outGain);
      this._limCeilLin = dbToLin(P.limCeil);
      this._limAtkC = coefMs(0.3, fs);
      this._limRelC = coefMs(150, fs);
      this.cmpDet.setTimes(fs, P.cmpAtk, P.cmpRel);

      // coefficient-bearing stages only when their params changed (biquad .set uses trig)
      const key = [P.eqHpf, P.eqLow, P.eqTone, P.eqAir, P.dssFreq].join('|');
      if (key !== this._prevKey) {
        this._prevKey = key;
        for (const s of this.ch) {
          s.hpf.set('highpass', fs, P.eqHpf, 0.707, 0);
          s.low.set(P.eqLow === 0 ? 'passthrough' : 'lowshelf', fs, 180, 0.707, P.eqLow);
          s.tiltLo.set(P.eqTone === 0 ? 'passthrough' : 'lowshelf', fs, 250, 0.707, -P.eqTone / 2);
          s.tiltHi.set(P.eqTone === 0 ? 'passthrough' : 'highshelf', fs, 3500, 0.707, P.eqTone / 2);
          s.air.set(P.eqAir === 0 ? 'passthrough' : 'highshelf', fs, 10000, 0.707, P.eqAir);
        }
        this.dssBp.set('bandpass', fs, P.dssFreq, 0.9, 0);
      }
    }

    reset() {
      for (const s of this.ch) {
        s.dssShelf.reset(); s.hpf.reset(); s.low.reset(); s.tiltLo.reset(); s.tiltHi.reset(); s.air.reset();
        s.os.reset(); s.limRing.fill(0);
      }
      this.dssBp.reset();
      this.gateDet.env = 0; this.dssDet.env = 0; this.cmpDet.env = 0;
      this.gateGDb = 0; this.dssGDb = 0; this.limG = 1; this.limIdx = 0;
      this.limGRing.fill(1);
    }

    /**
     * Process one block IN PLACE. chans: array of Float32Array (length >= n), one per channel.
     * Returns metering snapshot.
     */
    processBlock(chans, n) {
      const P = this.p, fs = this.fs, nCh = this.nCh;
      if (this._dssArr.length < n) this._dssArr = new Float32Array(n);

      // ---- input peak ----
      let inPk = 0;
      for (let c = 0; c < nCh; c++) {
        const d = chans[c];
        for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > inPk) inPk = a; }
      }

      if (P.bypass > 0.5) {
        let outPk = 0;
        for (let c = 0; c < nCh; c++) {
          const d = chans[c];
          for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > outPk) outPk = a; }
        }
        this.meters = { inPk, outPk, gateGrDb: 0, dssGrDb: 0, cmpGrDb: 0, limGrDb: 0 };
        return this.meters;
      }

      /* ---- 1) GATE ---- */
      let gateGr = 0;
      if (P.gateOn > 0.5) {
        const thrL = this._gateThrLin, rangeDb = P.gateRange;
        const openC = this._gateOpenC, closeC = this._gateCloseC;
        const det = this.gateDet;
        let gDb = this.gateGDb;
        for (let i = 0; i < n; i++) {
          let m = 0;
          for (let c = 0; c < nCh; c++) { const a = Math.abs(chans[c][i]); if (a > m) m = a; }
          const env = det.proc(m);
          const target = env < thrL ? rangeDb : 0;
          const k = target < gDb ? closeC : openC; // closing uses Release, opening is fast
          gDb = k * gDb + (1 - k) * target;
          const g = Math.pow(10, gDb / 20);
          for (let c = 0; c < nCh; c++) chans[c][i] *= g;
          if (-gDb > gateGr) gateGr = -gDb;
        }
        this.gateGDb = gDb;
      } else this.gateGDb = 0;

      /* ---- 2) DE-ESSER (dynamic high-shelf driven by sibilant band) ---- */
      let dssGr = 0;
      if (P.dssOn > 0.5 && P.dssAmt > 0) {
        const bp = this.dssBp, det = this.dssDet;
        const thr = P.dssThr, mult = this._dssMult;
        const atkC = this._dssAtkC, relC = this._dssRelC;
        const arr = this._dssArr;
        const midScale = nCh > 1 ? 0.5 : 1;
        let s = this.dssGDb;
        // pass 1: linked detection → per-sample smoothed reduction (dB)
        for (let i = 0; i < n; i++) {
          let mid = 0;
          for (let c = 0; c < nCh; c++) mid += chans[c][i];
          const b = bp.proc(mid * midScale);
          const env = det.proc(b < 0 ? -b : b);
          const over = linToDb(env) - thr;
          const tgt = over > 0 ? Math.min(30, over * mult) : 0;
          const k = tgt > s ? atkC : relC;
          s = k * s + (1 - k) * tgt;
          arr[i] = s;
          if (s > dssGr) dssGr = s;
        }
        this.dssGDb = s;
        // pass 2: apply as dynamic shelf, coefficients refreshed every 16 samples
        const freq = P.dssFreq;
        for (let c = 0; c < nCh; c++) {
          const shelf = this.ch[c].dssShelf, d = chans[c];
          for (let i = 0; i < n;) {
            const j = Math.min(i + 16, n);
            shelf.set('highshelf', fs, freq, 0.71, -arr[(i + j - 1) >> 1]);
            for (; i < j; i++) d[i] = shelf.proc(d[i]);
          }
        }
        // detector-only channels beyond nCh never run — dssShelf stays clean
      } else this.dssGDb = 0;

      /* ---- 3) TONE EQ (HPF → Low → Tilt → Air) ---- */
      if (P.eqOn > 0.5) {
        for (let c = 0; c < nCh; c++) {
          const st = this.ch[c], d = chans[c];
          const hpf = st.hpf, low = st.low, tlo = st.tiltLo, thi = st.tiltHi, air = st.air;
          for (let i = 0; i < n; i++) {
            let v = d[i];
            v = hpf.proc(v); v = low.proc(v); v = tlo.proc(v); v = thi.proc(v); v = air.proc(v);
            d[i] = v;
          }
        }
      }

      /* ---- 4) COMPRESSOR (linked, soft-knee, peak detector) ---- */
      let cmpGr = 0;
      if (P.cmpOn > 0.5) {
        const det = this.cmpDet, thr = P.cmpThr, ratio = P.cmpRatio;
        const mk = this._cmpMakeLin;
        for (let i = 0; i < n; i++) {
          let m = 0;
          for (let c = 0; c < nCh; c++) { const a = Math.abs(chans[c][i]); if (a > m) m = a; }
          const env = det.proc(m);
          const gr = compGrDb(linToDb(env), thr, ratio, 6);
          const g = Math.pow(10, -gr / 20) * mk;
          for (let c = 0; c < nCh; c++) chans[c][i] *= g;
          if (gr > cmpGr) cmpGr = gr;
        }
      }

      /* ---- 5) HEAT (4x-oversampled tanh saturator with dry/wet) ---- */
      if (P.satOn > 0.5) {
        const g = Math.pow(10, P.satDrive / 20);
        const mix = P.satMix, wet = mix, dry = 1 - mix;
        const shape = v => Math.tanh(g * v) / g; // unity small-signal gain at any drive
        for (let c = 0; c < nCh; c++) {
          const os = this.ch[c].os, d = chans[c];
          if (wet >= 1) { for (let i = 0; i < n; i++) d[i] = os.proc(d[i], shape); }
          else { for (let i = 0; i < n; i++) { const x = d[i]; d[i] = dry * x + wet * os.proc(x, shape); } }
        }
      }

      /* ---- 6) OUT GAIN (pre-limiter "push") ---- */
      const outLin = this._outLin;
      if (outLin !== 1) {
        for (let c = 0; c < nCh; c++) {
          const d = chans[c];
          for (let i = 0; i < n; i++) d[i] *= outLin;
        }
      }

      /* ---- 7) LIMITER (2 ms lookahead, fast attack, program release) ---- */
      let limGrDb = 0;
      {
        const on = P.limOn > 0.5;
        const ceil = this._limCeilLin, atkC = this._limAtkC, relC = this._limRelC;
        const L = this._limLen();
        let idx = this.limIdx, gs = this.limG;
        const gring = this.limGRing; // per-sample gain requirement, aligned with the delay rings
        for (let i = 0; i < n; i++) {
          let m = 0;
          for (let c = 0; c < nCh; c++) { const a = Math.abs(chans[c][i]); if (a > m) m = a; }
          const gi = m > ceil ? ceil / m : 1;
          // smoothed gain on the INPUT side: attack unfolds during the lookahead window
          const k = gi < gs ? atkC : relC;
          gs = k * gs + (1 - k) * gi;
          // hard cap from the exiting sample's own requirement → no overshoot, even on noise
          const cap = gring[idx];
          gring[idx] = gi;
          const gOut = gs < cap ? gs : cap;
          for (let c = 0; c < nCh; c++) {
            // rings stay fed even when bypassed → no stale audio on toggle
            const ring = this.ch[c].limRing, d = chans[c];
            const delayed = ring[idx];
            ring[idx] = d[i];
            if (on) d[i] = delayed * gOut;
          }
          if (on && gOut < 1) { const g = -linToDb(gOut); if (g > limGrDb) limGrDb = g; }
          idx++; if (idx >= L) idx = 0;
        }
        this.limIdx = idx;
        this.limG = on ? gs : 1;
      }

      // ---- output peak ----
      let outPk = 0;
      for (let c = 0; c < nCh; c++) {
        const d = chans[c];
        for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > outPk) outPk = a; }
      }

      this.meters = { inPk, outPk, gateGrDb: gateGr, dssGrDb: dssGr, cmpGrDb: cmpGr, limGrDb: limGrDb };
      return this.meters;
    }
  }

  return { Biquad, Detector, VoxChain, Oversampler4, compGrDb, PARAM_DEFS, PARAM_MAP, defaultParams, dbToLin, linToDb, coefMs, clamp };
});
