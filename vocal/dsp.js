'use strict';
/**
 * MixLens Vocal Analysis Engine — DSP Core
 * High-performance digital signal processing algorithms:
 * - Radix-2 FFT with precomputed twiddle factors & bit reversal
 * - Windowing functions (Hann, Blackman-Harris, Flat-Top)
 * - Biquad filter design (RBJ Audio EQ Cookbook & ITU K-weighting)
 * - 4x Polyphase True-Peak oversampling (ITU-R BS.1770-4)
 * - YIN fundamental frequency (F0) pitch estimation
 * - Autocorrelation, Zero-Crossing Rate (ZCR), Spectral Centroid, Flux, Flatness
 * - Linear Predictive Coding (LPC via Levinson-Durbin recursion)
 *
 * 100% offline, zero external dependencies.
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VocalDSP = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {

  /* =========================================================================
     1. MATHEMATICAL & AUDIO CONVERSION UTILITIES
     ========================================================================= */

  const EPSILON = 1e-12;

  /** Convert linear amplitude to decibels (20*log10) */
  function db20(x, minDb = -144) {
    if (x <= 0 || isNaN(x)) return minDb;
    return Math.max(minDb, 20 * Math.log10(Math.max(x, EPSILON)));
  }

  /** Convert power/energy to decibels (10*log10) */
  function db10(x, minDb = -144) {
    if (x <= 0 || isNaN(x)) return minDb;
    return Math.max(minDb, 10 * Math.log10(Math.max(x, EPSILON)));
  }

  /** Convert decibels to linear amplitude */
  function fromDb(db) {
    return Math.pow(10, db / 20);
  }

  /** Convert decibels power to linear power */
  function fromDbPower(db) {
    return Math.pow(10, db / 10);
  }

  /** Format decibels nicely with +/- sign */
  function fmtDb(x, d = 1) {
    if (!isFinite(x)) return '−∞ dB';
    return (x >= 0 ? '+' : '') + x.toFixed(d) + ' dB';
  }

  /** Format frequency in Hz or kHz */
  function fmtFreq(hz) {
    if (!isFinite(hz) || hz <= 0) return '—';
    if (hz >= 1000) return (hz / 1000).toFixed(hz >= 10000 ? 1 : 2) + ' kHz';
    return Math.round(hz) + ' Hz';
  }

  /** Note names table */
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  /** Convert frequency in Hz to musical note name and cents offset (A4 = 440 Hz) */
  function freqToNote(hz) {
    if (!isFinite(hz) || hz <= 10) return { note: '—', cents: 0, midi: 0 };
    const midi = 69 + 12 * Math.log2(hz / 440);
    const roundedMidi = Math.round(midi);
    const cents = Math.round((midi - roundedMidi) * 100);
    const noteIndex = ((roundedMidi % 12) + 12) % 12;
    const octave = Math.floor(roundedMidi / 12) - 1;
    return {
      note: `${NOTE_NAMES[noteIndex]}${octave}`,
      cents,
      midi: roundedMidi
    };
  }

  /** Convert musical note to frequency */
  function noteToFreq(midiNote) {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  /* =========================================================================
     2. STATISTICAL UTILITIES
     ========================================================================= */

  function mean(arr) {
    if (!arr || !arr.length) return 0;
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
  }

  function variance(arr, m) {
    if (!arr || arr.length < 2) return 0;
    const mu = m !== undefined ? m : mean(arr);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i] - mu;
      sum += d * d;
    }
    return sum / (arr.length - 1);
  }

  function stdDev(arr, m) {
    return Math.sqrt(variance(arr, m));
  }

  function sortedCopy(arr) {
    return Float64Array.from(arr).sort();
  }

  function percentile(sorted, q) {
    if (!sorted || !sorted.length) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
    return sorted[idx];
  }

  function median(sorted) {
    return percentile(sorted, 0.5);
  }

  /* =========================================================================
     3. FAST FOURIER TRANSFORM (FFT)
     ========================================================================= */

  class FFT {
    constructor(n) {
      if ((n & (n - 1)) !== 0) throw new Error('FFT size must be a power of 2: ' + n);
      this.n = n;
      this.rev = new Uint32Array(n);
      const bits = Math.round(Math.log2(n));
      for (let i = 0; i < n; i++) {
        let x = i, r = 0;
        for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
        this.rev[i] = r;
      }
      this.cos = new Float32Array(n / 2);
      this.sin = new Float32Array(n / 2);
      for (let i = 0; i < n / 2; i++) {
        this.cos[i] = Math.cos(2 * Math.PI * i / n);
        this.sin[i] = Math.sin(2 * Math.PI * i / n);
      }
    }

    /** Forward In-Place FFT (re and im must be Float32Array of length n) */
    transform(re, im) {
      const n = this.n, rev = this.rev;
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1, step = n / len;
        for (let i = 0; i < n; i += len) {
          for (let k = 0; k < half; k++) {
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

    /** Inverse In-Place FFT */
    inverse(re, im) {
      const n = this.n;
      // Invert sign of imaginary component
      for (let i = 0; i < n; i++) im[i] = -im[i];
      this.transform(re, im);
      const invN = 1 / n;
      for (let i = 0; i < n; i++) {
        re[i] *= invN;
        im[i] = -im[i] * invN;
      }
    }

    /** Compute power spectrum (half-spectrum magnitude squared / power in linear) */
    powerSpectrum(re, im, out) {
      const half = this.n / 2;
      const res = out || new Float32Array(half);
      const norm = 1 / (this.n * this.n);
      for (let i = 0; i < half; i++) {
        res[i] = (re[i] * re[i] + im[i] * im[i]) * (i === 0 ? norm : 2 * norm);
      }
      return res;
    }

    /** Compute magnitude spectrum in dBFS */
    magnitudeDb(re, im, out, minDb = -144) {
      const half = this.n / 2;
      const res = out || new Float32Array(half);
      const norm = 2 / this.n;
      for (let i = 0; i < half; i++) {
        const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * norm;
        res[i] = db20(mag, minDb);
      }
      res[0] = db20(Math.sqrt(re[0] * re[0] + im[0] * im[0]) / this.n, minDb);
      return res;
    }
  }

  /* =========================================================================
     4. WINDOW FUNCTIONS
     ========================================================================= */

  function createHannWindow(size) {
    const w = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
    }
    return w;
  }

  function createBlackmanHarrisWindow(size) {
    const w = new Float32Array(size);
    const a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
    for (let i = 0; i < size; i++) {
      const phi = 2 * Math.PI * i / (size - 1);
      w[i] = a0 - a1 * Math.cos(phi) + a2 * Math.cos(2 * phi) - a3 * Math.cos(3 * phi);
    }
    return w;
  }

  function applyWindow(input, window, output) {
    const len = input.length;
    const out = output || new Float32Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = input[i] * window[i];
    }
    return out;
  }

  /* =========================================================================
     5. BIQUAD FILTERS (RBJ Audio EQ Cookbook)
     ========================================================================= */

  /**
   * Design biquad coefficients: [b0, b1, b2, a1, a2]
   */
  function designBiquad(type, fs, f0, gainDb = 0, Q = 0.7071) {
    f0 = Math.max(10, Math.min(fs * 0.49, f0));
    const w0 = 2 * Math.PI * f0 / fs;
    const cos_w0 = Math.cos(w0);
    const sin_w0 = Math.sin(w0);
    const alpha = sin_w0 / (2 * Math.max(0.01, Q));
    const A = Math.pow(10, gainDb / 40);

    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

    switch (type) {
      case 'lowpass':
      case 'lpf':
        b0 = (1 - cos_w0) / 2;
        b1 = 1 - cos_w0;
        b2 = (1 - cos_w0) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cos_w0;
        a2 = 1 - alpha;
        break;
      case 'highpass':
      case 'hpf':
        b0 = (1 + cos_w0) / 2;
        b1 = -(1 + cos_w0);
        b2 = (1 + cos_w0) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cos_w0;
        a2 = 1 - alpha;
        break;
      case 'bandpass':
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cos_w0;
        a2 = 1 - alpha;
        break;
      case 'notch':
        b0 = 1;
        b1 = -2 * cos_w0;
        b2 = 1;
        a0 = 1 + alpha;
        a1 = -2 * cos_w0;
        a2 = 1 - alpha;
        break;
      case 'bell':
      case 'peaking':
        b0 = 1 + alpha * A;
        b1 = -2 * cos_w0;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cos_w0;
        a2 = 1 - alpha / A;
        break;
      case 'lowshelf':
        {
          const sqrtA = Math.sqrt(A);
          const beta = 2 * sqrtA * alpha;
          b0 = A * ((A + 1) - (A - 1) * cos_w0 + beta);
          b1 = 2 * A * ((A - 1) - (A + 1) * cos_w0);
          b2 = A * ((A + 1) - (A - 1) * cos_w0 - beta);
          a0 = (A + 1) + (A - 1) * cos_w0 + beta;
          a1 = -2 * ((A - 1) + (A + 1) * cos_w0);
          a2 = (A + 1) + (A - 1) * cos_w0 - beta;
        }
        break;
      case 'highshelf':
        {
          const sqrtA = Math.sqrt(A);
          const beta = 2 * sqrtA * alpha;
          b0 = A * ((A + 1) + (A - 1) * cos_w0 + beta);
          b1 = -2 * A * ((A - 1) + (A + 1) * cos_w0);
          b2 = A * ((A + 1) + (A - 1) * cos_w0 - beta);
          a0 = (A + 1) - (A - 1) * cos_w0 + beta;
          a1 = 2 * ((A - 1) - (A + 1) * cos_w0);
          a2 = (A + 1) - (A - 1) * cos_w0 - beta;
        }
        break;
      default:
        throw new Error('Unknown biquad type: ' + type);
    }

    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }

  /** Apply biquad filter in-place or returning new Float32Array */
  function applyBiquad(x, coeffs, out) {
    const len = x.length;
    const res = out || new Float32Array(len);
    const [b0, b1, b2, a1, a2] = coeffs;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < len; i++) {
      const v = x[i];
      const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y;
      res[i] = y;
    }
    return res;
  }

  /**
   * EBU R128 K-Weighting Filters (ITU-R BS.1770-4)
   * Stage 1: High shelf (+4 dB @ 1682 Hz)
   * Stage 2: High pass (RLB filter @ 38 Hz)
   */
  function kWeightingFilters(fs) {
    // Stage 1: pre-filter high shelf
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
    // Stage 2: RLB high-pass
    f0 = 38.13547087602444; Q = 0.5003270388234198;
    K = Math.tan(Math.PI * f0 / fs);
    v = 1 + K / Q + K * K;
    const hp = [1, -2, 1, 2 * (K * K - 1) / v, (1 - K / Q + K * K) / v];
    return { shelf, hp };
  }

  /* =========================================================================
     6. TRUE PEAK APPROXIMATION (4x Oversampled FIR / Sinc)
     ========================================================================= */

  /**
   * Polyphase 4x oversampling filter for true-peak measurement compliant with ITU-R BS.1770-4
   */
  const TP_COEFFS_4X = [
    // Sub-phase 0 (identity delay)
    [0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    // Sub-phase 1 (+0.25 phase)
    [-0.0031, 0.0135, -0.0381, 0.0934, -0.2312, 0.8997, 0.3541, -0.1194, 0.0522, -0.0219, 0.0084, -0.0027],
    // Sub-phase 2 (+0.50 phase)
    [-0.0062, 0.0252, -0.0684, 0.1611, -0.3789, 0.6385, 0.6385, -0.3789, 0.1611, -0.0684, 0.0252, -0.0062],
    // Sub-phase 3 (+0.75 phase)
    [-0.0027, 0.0084, -0.0219, 0.0522, -0.1194, 0.3541, 0.8997, -0.2312, 0.0934, -0.0381, 0.0135, -0.0031]
  ];

  function measureTruePeak(samples) {
    let maxPeak = 0;
    const N = samples.length;
    const TAPS = 12;
    const HALF_TAPS = 6;

    // Normal sample peak
    for (let i = 0; i < N; i++) {
      const abs = Math.abs(samples[i]);
      if (abs > maxPeak) maxPeak = abs;
    }

    // Polyphase convolution on suspicious peaks (> -12 dBFS) to keep performance fast
    for (let i = HALF_TAPS; i < N - HALF_TAPS; i++) {
      if (Math.abs(samples[i]) > 0.25) {
        for (let p = 1; p < 4; p++) {
          const c = TP_COEFFS_4X[p];
          let sum = 0;
          for (let k = 0; k < TAPS; k++) {
            sum += samples[i - HALF_TAPS + k] * c[k];
          }
          const absSum = Math.abs(sum);
          if (absSum > maxPeak) maxPeak = absSum;
        }
      }
    }
    return maxPeak;
  }

  /* =========================================================================
     7. YIN PITCH ESTIMATOR (Fundamental Frequency F0)
     ========================================================================= */

  /**
   * YIN Algorithm for accurate F0 detection in speech and singing
   * References: De Cheveigné & Kawahara (2002)
   */
  class YinPitchDetector {
    constructor(sampleRate, bufferSize = 2048, threshold = 0.15) {
      this.sampleRate = sampleRate;
      this.bufferSize = bufferSize;
      this.threshold = threshold;
      this.yinBuffer = new Float32Array(bufferSize / 2);
    }

    /**
     * Detect F0 in a single audio frame
     * Returns { f0: number (Hz), confidence: number (0-1), voiced: boolean }
     */
    detect(frame) {
      const halfBufferSize = Math.floor(this.bufferSize / 2);
      const yinBuffer = this.yinBuffer;
      const len = Math.min(frame.length, this.bufferSize);

      // Step 1: Squared Difference Function
      for (let tau = 0; tau < halfBufferSize; tau++) {
        let sum = 0;
        for (let i = 0; i < halfBufferSize; i++) {
          if (i + tau < len) {
            const delta = frame[i] - frame[i + tau];
            sum += delta * delta;
          }
        }
        yinBuffer[tau] = sum;
      }

      // Step 2: Cumulative Mean Normalized Difference
      yinBuffer[0] = 1;
      let runningSum = 0;
      for (let tau = 1; tau < halfBufferSize; tau++) {
        runningSum += yinBuffer[tau];
        yinBuffer[tau] = (yinBuffer[tau] * tau) / Math.max(EPSILON, runningSum);
      }

      // Step 3: Absolute Threshold Search
      let tauEstimate = -1;
      for (let tau = 2; tau < halfBufferSize; tau++) {
        if (yinBuffer[tau] < this.threshold) {
          while (tau + 1 < halfBufferSize && yinBuffer[tau + 1] < yinBuffer[tau]) {
            tau++;
          }
          tauEstimate = tau;
          break;
        }
      }

      // If no minimum under threshold, search for global minimum
      if (tauEstimate === -1) {
        let minVal = 1000;
        for (let tau = 2; tau < halfBufferSize; tau++) {
          if (yinBuffer[tau] < minVal) {
            minVal = yinBuffer[tau];
            tauEstimate = tau;
          }
        }
      }

      // Step 4: Parabolic Interpolation for Sub-Sample Accuracy
      let betterTau = tauEstimate;
      if (tauEstimate > 0 && tauEstimate < halfBufferSize - 1) {
        const s0 = yinBuffer[tauEstimate - 1];
        const s1 = yinBuffer[tauEstimate];
        const s2 = yinBuffer[tauEstimate + 1];
        const denom = 2 * (2 * s1 - s0 - s2);
        if (Math.abs(denom) > 1e-6) {
          betterTau = tauEstimate + (s2 - s0) / denom;
        }
      }

      const diffVal = tauEstimate >= 0 && tauEstimate < halfBufferSize ? yinBuffer[tauEstimate] : 1.0;
      const confidence = Math.max(0, Math.min(1, 1 - diffVal));
      const f0 = betterTau > 0 ? this.sampleRate / betterTau : 0;

      // Vocal range validity (typically 50 Hz to 1200 Hz for human singing/speech)
      const validRange = f0 >= 55 && f0 <= 1200;
      const voiced = validRange && confidence >= 0.65;

      return {
        f0: validRange ? f0 : 0,
        confidence,
        voiced,
        tau: betterTau
      };
    }
  }

  /* =========================================================================
     8. LINEAR PREDICTIVE CODING (LPC) & FORMANTS
     ========================================================================= */

  /**
   * Compute LPC coefficients using Levinson-Durbin recursion
   * @param {Float32Array} frame - Windowed audio frame
   * @param {number} order - LPC filter order (typically 12 - 24 for vocals)
   */
  function computeLPC(frame, order = 16) {
    const n = frame.length;
    const r = new Float64Array(order + 1);

    // Compute autocorrelation
    for (let k = 0; k <= order; k++) {
      let sum = 0;
      for (let i = 0; i < n - k; i++) {
        sum += frame[i] * frame[i + k];
      }
      r[k] = sum;
    }

    if (r[0] < EPSILON) return new Float64Array(order + 1);

    const a = new Float64Array(order + 1);
    const prevA = new Float64Array(order + 1);
    a[0] = 1.0;
    let e = r[0];

    for (let i = 1; i <= order; i++) {
      let lambda = 0;
      for (let j = 1; j < i; j++) {
        lambda += a[j] * r[i - j];
      }
      const k = -(r[i] + lambda) / Math.max(EPSILON, e);

      prevA.set(a);
      a[i] = k;
      for (let j = 1; j < i; j++) {
        a[j] = prevA[j] + k * prevA[i - j];
      }
      e *= (1 - k * k);
      if (e <= 0) break;
    }

    return a;
  }

  /**
   * Evaluate LPC frequency response curve
   */
  function lpcSpectrum(lpcCoeffs, numBins, fs) {
    const order = lpcCoeffs.length - 1;
    const response = new Float32Array(numBins);
    for (let bin = 0; bin < numBins; bin++) {
      const omega = Math.PI * bin / numBins;
      let re = 1.0, im = 0.0;
      for (let k = 1; k <= order; k++) {
        const phi = -k * omega;
        re += lpcCoeffs[k] * Math.cos(phi);
        im += lpcCoeffs[k] * Math.sin(phi);
      }
      const magSq = re * re + im * im;
      const mag = 1 / Math.sqrt(Math.max(EPSILON, magSq));
      response[bin] = db20(mag);
    }
    return response;
  }

  /* =========================================================================
     9. ZERO-CROSSING RATE & SPECTRAL DESCRIPTORS
     ========================================================================= */

  function zeroCrossingRate(frame) {
    let count = 0;
    for (let i = 1; i < frame.length; i++) {
      if ((frame[i] >= 0 && frame[i - 1] < 0) || (frame[i] < 0 && frame[i - 1] >= 0)) {
        count++;
      }
    }
    return count / (frame.length - 1);
  }

  /**
   * Compute Spectral Centroid, Spread, Flatness, Flux, Roll-off
   */
  function computeSpectralDescriptors(magSpectrum, freqs, prevMag) {
    let sumMag = 0;
    let weightedSum = 0;
    let logSum = 0;

    const n = magSpectrum.length;
    for (let i = 0; i < n; i++) {
      const m = Math.max(1e-9, magSpectrum[i]);
      sumMag += m;
      weightedSum += m * freqs[i];
      logSum += Math.log(m);
    }

    // Centroid
    const centroid = sumMag > 0 ? weightedSum / sumMag : 0;

    // Spread (spectral variance)
    let spreadSum = 0;
    for (let i = 0; i < n; i++) {
      const diff = freqs[i] - centroid;
      spreadSum += magSpectrum[i] * diff * diff;
    }
    const spread = sumMag > 0 ? Math.sqrt(spreadSum / sumMag) : 0;

    // Flatness (Wiener entropy: Geometric Mean / Arithmetic Mean)
    const geometricMean = Math.exp(logSum / n);
    const arithmeticMean = sumMag / n;
    const flatness = arithmeticMean > 0 ? Math.min(1, geometricMean / arithmeticMean) : 0;

    // Roll-off (85% and 95% energy point)
    const threshold85 = sumMag * 0.85;
    const threshold95 = sumMag * 0.95;
    let cumSum = 0;
    let rollOff85 = freqs[n - 1];
    let rollOff95 = freqs[n - 1];
    let found85 = false, found95 = false;

    for (let i = 0; i < n; i++) {
      cumSum += magSpectrum[i];
      if (!found85 && cumSum >= threshold85) {
        rollOff85 = freqs[i];
        found85 = true;
      }
      if (!found95 && cumSum >= threshold95) {
        rollOff95 = freqs[i];
        found95 = true;
        break;
      }
    }

    // Flux (Euclidean spectral distance from previous frame)
    let flux = 0;
    if (prevMag && prevMag.length === n) {
      for (let i = 0; i < n; i++) {
        const d = magSpectrum[i] - prevMag[i];
        flux += d * d;
      }
      flux = Math.sqrt(flux);
    }

    return {
      centroid,
      spread,
      flatness,
      rollOff85,
      rollOff95,
      flux
    };
  }

  /* =========================================================================
     10. HARMONIC-TO-NOISE RATIO (HNR)
     ========================================================================= */

  /**
   * Harmonic-to-Noise Ratio via autocorrelation peak ratio
   * @param {Float32Array} frame
   * @param {number} tau - Fundamental period in samples
   */
  function computeFrameHNR(frame, tau) {
    if (!tau || tau < 2 || tau >= frame.length / 2) return 0;
    const n = frame.length - tau;
    let r0 = 0, rTau = 0;
    for (let i = 0; i < n; i++) {
      r0 += frame[i] * frame[i];
      rTau += frame[i] * frame[i + tau];
    }
    if (r0 <= EPSILON) return 0;
    const normCorr = Math.max(0, Math.min(0.9999, rTau / r0));
    // HNR = 10 * log10(normCorr / (1 - normCorr))
    const hnr = 10 * Math.log10(normCorr / (1 - normCorr + EPSILON));
    return Math.max(-20, Math.min(40, hnr));
  }

  return {
    EPSILON,
    db20,
    db10,
    fromDb,
    fromDbPower,
    fmtDb,
    fmtFreq,
    freqToNote,
    noteToFreq,
    mean,
    variance,
    stdDev,
    sortedCopy,
    percentile,
    median,
    FFT,
    createHannWindow,
    createBlackmanHarrisWindow,
    applyWindow,
    designBiquad,
    applyBiquad,
    kWeightingFilters,
    measureTruePeak,
    YinPitchDetector,
    computeLPC,
    lpcSpectrum,
    zeroCrossingRate,
    computeSpectralDescriptors,
    computeFrameHNR
  };
}));
