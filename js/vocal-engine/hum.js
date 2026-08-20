'use strict';
/**
 * MixLens Vocal Engine 3.0 — Mains-hum detector.
 * Measures 50/60 Hz families from quiet frames. Never assumes a region’s grid.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'), require('./fft'));
  } else {
    root.VEHum = factory(root.VEUtilities, root.VEFft);
  }
}(typeof self !== 'undefined' ? self : this, function (U, FftMod) {

  const TARGETS = [50, 60, 100, 120, 150, 180, 200, 240, 250];

  function analyzeHum(mono, sampleRate) {
    const frame = Math.max(64, Math.round(sampleRate * 0.05));
    const hop = Math.max(32, Math.round(frame / 2));
    const rmsList = [];
    for (let i = 0; i + frame <= mono.length; i += hop) {
      rmsList.push({ i: i, rms: U.rms(mono, i, i + frame) });
    }
    if (!rmsList.length) {
      return { detected: false, confidence: 0, evidence: 'Insufficient Signal', harmonics: [], lines: [] };
    }
    const sorted = U.sortedCopy(rmsList.map(function (r) { return r.rms; }));
    const p12 = U.percentile(sorted, 0.12);

    const fftSize = 4096;
    if (mono.length < fftSize) {
      return { detected: false, confidence: 0, evidence: 'Insufficient Signal', harmonics: [], lines: [] };
    }
    const fft = new FftMod.FFT(fftSize);
    const hann = U.hannWindow(fftSize);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    const avg = new Float64Array(fftSize / 2);
    let count = 0;

    for (let f = 0; f < rmsList.length && count < 48; f++) {
      if (rmsList[f].rms <= p12 * 1.6 && rmsList[f].i + fftSize <= mono.length) {
        for (let k = 0; k < fftSize; k++) { re[k] = mono[rmsList[f].i + k]; im[k] = 0; }
        U.applyWindow(re, hann, re);
        fft.transform(re, im);
        const p = fft.powerSpectrum(re, im);
        for (let b = 0; b < p.length; b++) avg[b] += p[b];
        count++;
      }
    }

    if (count < 2) {
      return {
        detected: false,
        confidence: 0,
        evidence: 'Insufficient quiet material for mains-hum estimation.',
        harmonics: [],
        lines: [],
        classification: 'Insufficient Signal'
      };
    }
    for (let b = 0; b < avg.length; b++) avg[b] /= count;
    const binHz = sampleRate / fftSize;

    function powerAt(hz) {
      const bin = Math.round(hz / binHz);
      if (bin <= 0 || bin >= avg.length) return 0;
      return avg[bin];
    }
    function floorAt(hz) {
      const bin = Math.round(hz / binHz);
      let s = 0, n = 0;
      for (let b = Math.max(1, bin - 6); b <= Math.min(avg.length - 1, bin + 6); b++) {
        if (Math.abs(b - bin) > 1) { s += avg[b]; n++; }
      }
      return n ? s / n : 1e-12;
    }

    const lines = TARGETS.map(function (hz) {
      if (hz >= sampleRate / 2) return null;
      const p = powerAt(hz);
      const fl = floorAt(hz);
      const ratio = p / Math.max(1e-18, fl);
      return {
        frequency_hz: hz,
        level_db: U.round(U.db10(p), 2),
        excess_db: U.round(U.db10(ratio), 2),
        present: ratio > 3.5
      };
    }).filter(Boolean);

    let best = null;
    for (const base of [50, 60]) {
      const series = [1, 2, 3, 4, 5].map(function (h) { return lines.find(function (l) { return l.frequency_hz === base * h; }); }).filter(Boolean);
      const present = series.filter(function (l) { return l.present; });
      const fund = series[0];
      if (!fund) continue;
      const score = (fund.present ? fund.excess_db : 0) + present.length * 2;
      if (!best || score > best.score) {
        best = {
          fundamental_hz: base,
          harmonics: present.map(function (l) { return l.frequency_hz; }),
          confidence: U.clamp(0.35 + present.length * 0.12 + (fund.excess_db > 8 ? 0.15 : 0), 0, 0.97),
          score: score,
          excess_db: fund.excess_db,
          present_count: present.length
        };
      }
    }

    const detected = !!(best && best.present_count >= 1 && best.excess_db >= 6 && best.confidence >= 0.55);
    return {
      detected: detected,
      fundamental_hz: detected ? best.fundamental_hz : null,
      harmonics: detected ? best.harmonics.filter(function (h) { return h !== best.fundamental_hz; }) : [],
      confidence: detected ? U.round(best.confidence * 100, 1) : U.round((best ? best.confidence : 0) * 100, 1),
      lines: lines,
      classification: detected ? (best.confidence >= 0.85 ? 'HIGH' : 'MODERATE') : 'GOOD',
      evidence: detected
        ? ('Quiet-frame spectrum shows ' + best.fundamental_hz + ' Hz with ' + best.present_count + ' related lines; excess ' + best.excess_db.toFixed(1) + ' dB vs local floor.')
        : 'No 50/60 Hz family exceeded the local quiet-floor prominence test.'
    };
  }

  return { analyzeHum };
}));
