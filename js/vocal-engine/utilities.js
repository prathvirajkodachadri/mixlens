'use strict';
/**
 * MixLens Vocal Engine 3.0 — Shared DSP utilities.
 *
 * Assumptions:
 * - Amplitude dB uses 20*log10 (dBFS relative to |x|=1).
 * - Power/energy dB uses 10*log10.
 * - Musical pitch uses A4 = 440 Hz, 12-TET.
 * - Tiny values are clamped so logarithms stay defined; they are not invented measurements.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VEUtilities = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const EPSILON = 1e-12;
  const MIN_DB = -144;
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const ENGINE_VERSION = '3.0.0';
  const SCHEMA_VERSION = '3.0';
  const ANALYSIS_VERSION = '2026.08';

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

  function fmtFreq(hz) {
    if (!isFinite(hz) || hz <= 0) return '—';
    if (hz >= 1000) return (hz / 1000).toFixed(hz >= 10000 ? 1 : 2) + ' kHz';
    return (hz >= 100 ? Math.round(hz) : hz.toFixed(1)) + ' Hz';
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00.00';
    const sign = sec < 0 ? '-' : '';
    const s = Math.abs(sec);
    const m = Math.floor(s / 60);
    const rem = s - m * 60;
    const whole = Math.floor(rem);
    const frac = Math.round((rem - whole) * 100);
    const adjWhole = frac === 100 ? whole + 1 : whole;
    const adjFrac = frac === 100 ? 0 : frac;
    return sign + m + ':' + String(adjWhole).padStart(2, '0') + '.' + String(adjFrac).padStart(2, '0');
  }

  function fmtDuration(sec) {
    if (!isFinite(sec) || sec < 0) return 'Not available';
    return fmtTime(sec);
  }

  function freqToNote(hz) {
    if (!isFinite(hz) || hz <= 10) return { note: '—', cents: 0, midi: 0 };
    const midi = 69 + 12 * Math.log2(hz / 440);
    const roundedMidi = Math.round(midi);
    const cents = Math.round((midi - roundedMidi) * 100);
    const noteIndex = ((roundedMidi % 12) + 12) % 12;
    const octave = Math.floor(roundedMidi / 12) - 1;
    return { note: NOTE_NAMES[noteIndex] + octave, cents, midi: roundedMidi };
  }

  function noteToFreq(midiNote) {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
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
    const sorted = isSortedHint(sortedOrArr) ? sortedOrArr : sortedCopy(sortedOrArr);
    return percentile(sorted, 0.5);
  }

  function isSortedHint(arr) {
    return arr && arr._sorted === true;
  }

  function markSorted(arr) {
    if (arr) arr._sorted = true;
    return arr;
  }

  function zeroCrossingRate(frame) {
    if (!frame || frame.length < 2) return 0;
    let count = 0;
    for (let i = 1; i < frame.length; i++) {
      if ((frame[i] >= 0 && frame[i - 1] < 0) || (frame[i] < 0 && frame[i - 1] >= 0)) count++;
    }
    return count / (frame.length - 1);
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

  function designBiquad(type, fs, f0, gainDb, Q) {
    const g = gainDb == null ? 0 : gainDb;
    const q = Q == null ? 0.7071 : Q;
    f0 = Math.max(10, Math.min(fs * 0.49, f0));
    const w0 = 2 * Math.PI * f0 / fs;
    const cosw = Math.cos(w0);
    const sinw = Math.sin(w0);
    const alpha = sinw / (2 * Math.max(0.01, q));
    const A = Math.pow(10, g / 40);
    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    switch (type) {
      case 'lowpass':
      case 'lpf':
        b0 = (1 - cosw) / 2; b1 = 1 - cosw; b2 = (1 - cosw) / 2;
        a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
        break;
      case 'highpass':
      case 'hpf':
        b0 = (1 + cosw) / 2; b1 = -(1 + cosw); b2 = (1 + cosw) / 2;
        a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
        break;
      case 'bandpass':
        b0 = alpha; b1 = 0; b2 = -alpha;
        a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
        break;
      case 'notch':
        b0 = 1; b1 = -2 * cosw; b2 = 1;
        a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
        break;
      default:
        throw new Error('Unknown biquad type: ' + type);
    }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
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

  const TP_COEFFS_4X = [
    [0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    [-0.0031, 0.0135, -0.0381, 0.0934, -0.2312, 0.8997, 0.3541, -0.1194, 0.0522, -0.0219, 0.0084, -0.0027],
    [-0.0062, 0.0252, -0.0684, 0.1611, -0.3789, 0.6385, 0.6385, -0.3789, 0.1611, -0.0684, 0.0252, -0.0062],
    [-0.0027, 0.0084, -0.0219, 0.0522, -0.1194, 0.3541, 0.8997, -0.2312, 0.0934, -0.0381, 0.0135, -0.0031]
  ];

  /** 4× polyphase inter-sample peak estimate (ITU-style). */
  function measureTruePeak(samples) {
    let maxPeak = 0;
    const N = samples.length;
    const TAPS = 12;
    const HALF = 6;
    for (let i = 0; i < N; i++) {
      const a = Math.abs(samples[i]);
      if (a > maxPeak) maxPeak = a;
    }
    for (let i = HALF; i < N - HALF; i++) {
      if (Math.abs(samples[i]) > 0.25) {
        for (let p = 1; p < 4; p++) {
          const c = TP_COEFFS_4X[p];
          let acc = 0;
          for (let k = 0; k < TAPS; k++) acc += samples[i - HALF + k] * c[k];
          const a = Math.abs(acc);
          if (a > maxPeak) maxPeak = a;
        }
      }
    }
    return maxPeak;
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

  function na(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback == null ? 'Not available' : fallback;
    return value;
  }

  function severityFromScore(score) {
    if (score >= 90) return 'GOOD';
    if (score >= 75) return 'LOW';
    if (score >= 55) return 'MODERATE';
    if (score >= 30) return 'HIGH';
    return 'CRITICAL';
  }

  return {
    EPSILON, MIN_DB, NOTE_NAMES,
    ENGINE_VERSION, SCHEMA_VERSION, ANALYSIS_VERSION,
    dbToLinear, linearToDb, powerToDb, db20, db10, fromDb, fromDbPower,
    clamp, round, fmtDb, fmtDbAbs, fmtFreq, fmtTime, fmtDuration,
    freqToNote, noteToFreq, frequencyToBin, binToFrequency,
    mean, sum, rms, peak, variance, stdDev, sortedCopy, percentile, median, markSorted,
    zeroCrossingRate, hannWindow, applyWindow,
    spectralCentroid, spectralSpread, spectralRolloff, spectralFlatness, spectralFlux,
    designBiquad, applyBiquad, kWeightingFilters, measureTruePeak,
    yieldTick, downsampleMax, na, severityFromScore
  };
}));
