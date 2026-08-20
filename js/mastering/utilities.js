'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Shared DSP utilities.
 *
 * Amplitude dB uses 20*log10 (dBFS relative to |x|=1).
 * Power/energy dB uses 10*log10.
 * Tiny values are clamped so logarithms stay defined; they are not invented measurements.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MAUtilities = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const EPSILON = 1e-12;
  const MIN_DB = -144;
  const ENGINE_VERSION = '1.0.0';
  const SCHEMA_VERSION = '1.0';
  const ANALYSIS_VERSION = '2026.08';
  const ENGINE_NAME = 'Final Mastering Analysis';

  function dbToLinear(db) {
    return Math.pow(10, db / 20);
  }

  function linearToDb(x, minDb) {
    const floor = minDb == null ? MIN_DB : minDb;
    if (!(x > 0) || !isFinite(x)) return floor;
    return Math.max(floor, 20 * Math.log10(Math.max(x, EPSILON)));
  }

  function powerToDb(x, minDb) {
    const floor = minDb == null ? MIN_DB : minDb;
    if (!(x > 0) || !isFinite(x)) return floor;
    return Math.max(floor, 10 * Math.log10(Math.max(x, EPSILON)));
  }

  function db20(x, minDb) { return linearToDb(x, minDb); }
  function db10(x, minDb) { return powerToDb(x, minDb); }
  function fromDb(db) { return dbToLinear(db); }
  function fromDbPower(db) { return Math.pow(10, db / 10); }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  function round(x, digits) {
    if (!isFinite(x)) return x;
    const p = Math.pow(10, digits == null ? 1 : digits);
    return Math.round(x * p) / p;
  }

  function fmtDb(x, digits) {
    if (!isFinite(x)) return '−∞ dB';
    const d = digits == null ? 1 : digits;
    return (x >= 0 ? '+' : '') + x.toFixed(d) + ' dB';
  }

  function fmtDbAbs(x, digits) {
    if (!isFinite(x)) return '−∞ dB';
    return x.toFixed(digits == null ? 1 : digits) + ' dB';
  }

  function fmtLufs(x, digits) {
    if (!isFinite(x) || x <= MIN_DB + 1) return 'Not available';
    return x.toFixed(digits == null ? 1 : digits) + ' LUFS';
  }

  function fmtDbtp(x, digits) {
    if (!isFinite(x)) return 'Not available';
    return x.toFixed(digits == null ? 2 : digits) + ' dBTP';
  }

  function fmtFreq(hz) {
    if (!isFinite(hz) || hz <= 0) return '—';
    if (hz >= 1000) return (hz / 1000).toFixed(hz >= 10000 ? 1 : 2) + ' kHz';
    return (hz >= 100 ? Math.round(hz) : hz.toFixed(1)) + ' Hz';
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00.00';
    const s = Math.abs(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s - h * 3600) / 60);
    const rem = s - h * 3600 - m * 60;
    const whole = Math.floor(rem);
    let frac = Math.round((rem - whole) * 1000);
    let adjWhole = whole;
    if (frac === 1000) { adjWhole += 1; frac = 0; }
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    const core = mm + ':' + String(adjWhole).padStart(2, '0') + '.' + String(frac).padStart(3, '0');
    return h > 0 ? h + ':' + core : core;
  }

  function fmtDuration(sec) {
    if (!isFinite(sec) || sec < 0) return 'Not available';
    return fmtTime(sec);
  }

  function fmtBytes(n) {
    if (n == null || !isFinite(n)) return 'Not available';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function frequencyToBin(hz, sampleRate, fftSize) {
    return hz * fftSize / sampleRate;
  }

  function binToFrequency(bin, sampleRate, fftSize) {
    return bin * sampleRate / fftSize;
  }

  function mean(arr) {
    if (!arr || !arr.length) return 0;
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
  }

  function sum(arr) {
    let s = 0;
    if (!arr) return 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s;
  }

  function rms(arr, start, end) {
    const a = start == null ? 0 : start;
    const b = end == null ? (arr ? arr.length : 0) : end;
    const n = b - a;
    if (!arr || n <= 0) return 0;
    let acc = 0;
    for (let i = a; i < b; i++) acc += arr[i] * arr[i];
    return Math.sqrt(acc / n);
  }

  function peak(arr, start, end) {
    const a = start == null ? 0 : start;
    const b = end == null ? (arr ? arr.length : 0) : end;
    let p = 0;
    if (!arr) return 0;
    for (let i = a; i < b; i++) {
      const v = Math.abs(arr[i]);
      if (v > p) p = v;
    }
    return p;
  }

  function peakSigned(arr) {
    let pos = 0, neg = 0, posI = 0, negI = 0;
    if (!arr) return { pos: 0, neg: 0, posIndex: 0, negIndex: 0 };
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v > pos) { pos = v; posI = i; }
      if (v < neg) { neg = v; negI = i; }
    }
    return { pos: pos, neg: neg, posIndex: posI, negIndex: negI };
  }

  function variance(arr, m) {
    if (!arr || arr.length < 2) return 0;
    const mu = m !== undefined ? m : mean(arr);
    let acc = 0;
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i] - mu;
      acc += d * d;
    }
    return acc / (arr.length - 1);
  }

  function stdDev(arr, m) {
    return Math.sqrt(variance(arr, m));
  }

  function sortedCopy(arr) {
    if (!arr || !arr.length) return new Float64Array(0);
    return Float64Array.from(arr).sort();
  }

  function percentile(sorted, q) {
    if (!sorted || !sorted.length) return 0;
    if (sorted.length === 1) return sorted[0];
    const pos = clamp(q, 0, 1) * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    const t = pos - lo;
    return sorted[lo] * (1 - t) + sorted[hi] * t;
  }

  function median(sortedOrArr) {
    if (!sortedOrArr || !sortedOrArr.length) return 0;
    return percentile(sortedCopy(sortedOrArr), 0.5);
  }

  function hannWindow(size) {
    const w = new Float32Array(size);
    if (size <= 1) { w[0] = 1; return w; }
    for (let i = 0; i < size; i++) {
      w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
    }
    return w;
  }

  function applyWindow(input, window, output) {
    const len = Math.min(input.length, window.length);
    const out = output || new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = input[i] * window[i];
    return out;
  }

  function spectralCentroid(mag, freqs) {
    let num = 0, den = 0;
    const n = mag.length;
    for (let i = 0; i < n; i++) {
      const m = mag[i];
      if (m > 0) {
        den += m;
        num += m * freqs[i];
      }
    }
    return den > 0 ? num / den : 0;
  }

  function spectralSpread(mag, freqs, centroidHz) {
    const c = centroidHz == null ? spectralCentroid(mag, freqs) : centroidHz;
    let num = 0, den = 0;
    for (let i = 0; i < mag.length; i++) {
      const m = mag[i];
      if (m > 0) {
        const d = freqs[i] - c;
        num += m * d * d;
        den += m;
      }
    }
    return den > 0 ? Math.sqrt(num / den) : 0;
  }

  function spectralRolloff(mag, freqs, fraction) {
    const frac = fraction == null ? 0.85 : fraction;
    let total = 0;
    for (let i = 0; i < mag.length; i++) total += mag[i];
    if (total <= 0) return freqs[freqs.length - 1] || 0;
    const target = total * frac;
    let acc = 0;
    for (let i = 0; i < mag.length; i++) {
      acc += mag[i];
      if (acc >= target) return freqs[i];
    }
    return freqs[freqs.length - 1] || 0;
  }

  function spectralFlatness(mag) {
    const n = mag.length;
    if (!n) return 0;
    let logSum = 0;
    let arith = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const m = mag[i];
      if (m > 0) {
        logSum += Math.log(m);
        arith += m;
        count++;
      }
    }
    if (!count || arith <= 0) return 0;
    const geo = Math.exp(logSum / count);
    return clamp(geo / (arith / count), 0, 1);
  }

  function spectralFlux(mag, prevMag) {
    if (!prevMag || prevMag.length !== mag.length) return 0;
    let acc = 0;
    for (let i = 0; i < mag.length; i++) {
      const d = mag[i] - prevMag[i];
      acc += d * d;
    }
    return Math.sqrt(acc);
  }

  function applyBiquad(x, coeffs, out) {
    const res = out || new Float32Array(x.length);
    const b0 = coeffs[0], b1 = coeffs[1], b2 = coeffs[2], a1 = coeffs[3], a2 = coeffs[4];
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y;
      res[i] = y;
    }
    return res;
  }

  /**
   * ITU-R BS.1770-4 K-weighting biquads.
   * Stage 1: high shelf; Stage 2: RLB high-pass.
   */
  function kWeightingFilters(fs) {
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
      (1 - K / Q + K * K) / v
    ];
    f0 = 38.13547087602444; Q = 0.5003270388234198;
    K = Math.tan(Math.PI * f0 / fs);
    v = 1 + K / Q + K * K;
    const hp = [1, -2, 1, 2 * (K * K - 1) / v, (1 - K / Q + K * K) / v];
    return { shelf, hp };
  }

  function yieldTick() {
    return new Promise(function (resolve) { setTimeout(resolve, 0); });
  }

  function downsampleMax(arr, maxPoints) {
    if (!arr || arr.length <= maxPoints) return arr ? Array.from(arr) : [];
    const out = new Array(maxPoints);
    const step = arr.length / maxPoints;
    for (let i = 0; i < maxPoints; i++) {
      const a = Math.floor(i * step);
      const b = Math.max(a + 1, Math.floor((i + 1) * step));
      let mx = 0, mn = 0;
      for (let j = a; j < b && j < arr.length; j++) {
        const v = arr[j];
        if (v > mx) mx = v;
        if (v < mn) mn = v;
      }
      out[i] = Math.abs(mx) > Math.abs(mn) ? mx : mn;
    }
    return out;
  }

  function downsampleMinMax(arr, maxPoints) {
    if (!arr || arr.length <= maxPoints) {
      const src = arr ? Array.from(arr) : [];
      return src.map(function (v) { return { min: v, max: v }; });
    }
    const out = new Array(maxPoints);
    const step = arr.length / maxPoints;
    for (let i = 0; i < maxPoints; i++) {
      const a = Math.floor(i * step);
      const b = Math.max(a + 1, Math.floor((i + 1) * step));
      let mx = -Infinity, mn = Infinity;
      for (let j = a; j < b && j < arr.length; j++) {
        const v = arr[j];
        if (v > mx) mx = v;
        if (v < mn) mn = v;
      }
      out[i] = { min: mn, max: mx };
    }
    return out;
  }

  function mixToMono(left, right) {
    if (!right) {
      const copy = new Float32Array(left.length);
      copy.set(left);
      return copy;
    }
    const n = Math.min(left.length, right.length);
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) mono[i] = 0.5 * (left[i] + right[i]);
    return mono;
  }

  function validateAudio(length, sampleRate, duration) {
    const errors = [];
    const warnings = [];
    if (!length) errors.push('Empty file: no samples to analyze.');
    if (sampleRate && sampleRate < 8000) errors.push('Sample rate too low for analysis (' + sampleRate + ' Hz).');
    if (duration != null && duration < 0.08) errors.push('Master is too short for reliable analysis (minimum ~80 ms).');
    else if (duration != null && duration < 0.5) warnings.push('Very short file. Some loudness / LRA figures will be low-confidence.');
    if (duration != null && duration > 30 * 60) warnings.push('Very long file. Analysis uses decimated frames to stay responsive.');
    if (sampleRate && sampleRate < 44100) warnings.push('Sample rate below 44.1 kHz. Typical delivery masters use 44.1 or 48 kHz.');
    return { errors: errors, warnings: warnings };
  }

  function na(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback == null ? 'Not available' : fallback;
    return value;
  }

  function statusRank(s) {
    if (s === 'FAIL' || s === 'CRITICAL' || s === 'NOT READY') return 3;
    if (s === 'WARNING' || s === 'REVIEW' || s === 'READY WITH NOTES') return 2;
    if (s === 'PASS' || s === 'GOOD' || s === 'READY') return 0;
    return 1;
  }

  function worstStatus(list) {
    let worst = 'PASS';
    let rank = 0;
    (list || []).forEach(function (s) {
      const r = statusRank(s);
      if (r > rank) { rank = r; worst = s; }
    });
    return worst;
  }

  return {
    EPSILON, MIN_DB, ENGINE_VERSION, SCHEMA_VERSION, ANALYSIS_VERSION, ENGINE_NAME,
    dbToLinear, linearToDb, powerToDb, db20, db10, fromDb, fromDbPower,
    clamp, round, fmtDb, fmtDbAbs, fmtLufs, fmtDbtp, fmtFreq, fmtTime, fmtDuration, fmtBytes,
    frequencyToBin, binToFrequency,
    mean, sum, rms, peak, peakSigned, variance, stdDev, sortedCopy, percentile, median,
    hannWindow, applyWindow,
    spectralCentroid, spectralSpread, spectralRolloff, spectralFlatness, spectralFlux,
    applyBiquad, kWeightingFilters,
    yieldTick, downsampleMax, downsampleMinMax, mixToMono, validateAudio, na,
    statusRank, worstStatus
  };
}));
