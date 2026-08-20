'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Mono fold-down compatibility.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.MAMono = factory(root.MAUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function bandEnergyRatio(left, right, sampleRate, lo, hi) {
    /* One-pole band emphasis via simple FIR-ish sliding RMS on filtered copies is expensive.
       Use a cheap biquad bandpass energy comparison instead. */
    const nyq = sampleRate / 2;
    const f0 = Math.sqrt(lo * Math.min(hi, nyq * 0.98));
    const Q = f0 / Math.max(20, Math.min(hi, nyq) - lo);
    const w0 = 2 * Math.PI * f0 / sampleRate;
    const cosw = Math.cos(w0);
    const sinw = Math.sin(w0);
    const alpha = sinw / (2 * Math.max(0.3, Math.min(8, Q)));
    const b0 = alpha, b1 = 0, b2 = -alpha;
    const a0 = 1 + alpha, a1 = -2 * cosw, a2 = 1 - alpha;
    const c = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
    const fL = U.applyBiquad(left, c);
    const fR = U.applyBiquad(right, c);
    const n = Math.min(fL.length, fR.length);
    let eS = 0, eM = 0;
    for (let i = 0; i < n; i++) {
      const l = fL[i], r = fR[i];
      eS += (l * l + r * r) * 0.5;
      const m = 0.5 * (l + r);
      eM += m * m;
    }
    return eS > 1e-18 ? eM / eS : 1;
  }

  function analyzeMono(left, right, sampleRate) {
    if (!right) {
      return {
        applicable: false,
        rating: 'Not applicable',
        status: 'PASS',
        note: 'Source is already mono.',
        energy_ratio: 1,
        cancellation_db: 0
      };
    }
    const n = Math.min(left.length, right.length);
    let eStereo = 0, eMono = 0;
    for (let i = 0; i < n; i++) {
      const l = left[i], r = right[i];
      eStereo += (l * l + r * r) * 0.5;
      const m = 0.5 * (l + r);
      eMono += m * m;
    }
    const ratio = eStereo > 1e-18 ? eMono / eStereo : 1;
    const cancelDb = U.db10(Math.max(ratio, 1e-12));

    const lfRatio = bandEnergyRatio(left, right, sampleRate, 20, 120);
    const hfRatio = bandEnergyRatio(left, right, sampleRate, 5000, 12000);

    let rating = 'Excellent';
    let status = 'PASS';
    if (ratio < 0.35) { rating = 'Critical'; status = 'FAIL'; }
    else if (ratio < 0.55) { rating = 'Poor'; status = 'FAIL'; }
    else if (ratio < 0.72) { rating = 'Moderate'; status = 'WARNING'; }
    else if (ratio < 0.88) { rating = 'Good'; status = 'PASS'; }

    const evidence = [];
    evidence.push('Mono fold-down energy is ' + (ratio * 100).toFixed(1) + '% of mean stereo channel energy (' + cancelDb.toFixed(2) + ' dB).');
    if (lfRatio < 0.65) evidence.push('Low-frequency cancellation indicated in 20–120 Hz (mono/stereo energy ratio ' + lfRatio.toFixed(2) + ').');
    if (hfRatio < 0.55) evidence.push('High-frequency cancellation indicated in 5–12 kHz (mono/stereo energy ratio ' + hfRatio.toFixed(2) + ').');

    return {
      applicable: true,
      rating: rating,
      status: status,
      energy_ratio: U.round(ratio, 4),
      cancellation_db: U.round(cancelDb, 2),
      low_frequency_energy_ratio: U.round(lfRatio, 4),
      high_frequency_energy_ratio: U.round(hfRatio, 4),
      evidence: evidence,
      note: evidence.join(' ')
    };
  }

  return { analyzeMono: analyzeMono };
}));
