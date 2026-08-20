'use strict';
/**
 * MixLens Vocal Engine 3.0 — Resonance discrimination.
 * Distinguishes persistent narrow-band elevations from ordinary harmonic energy.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VEResonance = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function localBaseline(spec, idx, radius) {
    const vals = [];
    for (let i = Math.max(1, idx - radius); i <= Math.min(spec.length - 2, idx + radius); i++) {
      if (Math.abs(i - idx) < Math.max(2, Math.round(radius * 0.15))) continue;
      vals.push(spec[i]);
    }
    if (!vals.length) return spec[idx];
    return U.median(U.sortedCopy(vals));
  }

  function bandwidthAt(spec, freqs, idx, dropDb) {
    const peak = spec[idx];
    const thr = peak - dropDb;
    let lo = idx, hi = idx;
    while (lo > 1 && spec[lo] > thr) lo--;
    while (hi < spec.length - 2 && spec[hi] > thr) hi++;
    return Math.max(freqs[1] || 1, freqs[hi] - freqs[lo]);
  }

  function nearHarmonic(freq, f0) {
    if (!f0 || f0 < 50) return { harmonic: false, n: 0, cents: 999 };
    const n = Math.round(freq / f0);
    if (n < 1 || n > 16) return { harmonic: false, n: 0, cents: 999 };
    const target = n * f0;
    const cents = Math.abs(1200 * Math.log2(freq / target));
    return { harmonic: cents < 45, n: n, cents: cents };
  }

  function analyzeResonances(spectrum, pitch) {
    const stft = spectrum._stft;
    const freqs = stft.frequencies;
    const spec = stft.avgSpectrumDb;
    const frames = stft.timeFrames || [];
    const medianF0 = pitch && pitch.median_f0_hz ? pitch.median_f0_hz : 0;

    const candidates = [];
    const minF = 80, maxF = 8000;
    const radiusHz = 350;

    for (let i = 3; i < spec.length - 3; i++) {
      const f = freqs[i];
      if (f < minF || f > maxF) continue;
      if (!(spec[i] > spec[i - 1] && spec[i] >= spec[i + 1])) continue;
      if (!(spec[i] > spec[i - 2] && spec[i] > spec[i + 2])) continue;

      const radBins = Math.max(6, Math.round(radiusHz / stft.binWidth));
      const base = localBaseline(spec, i, radBins);
      const excess = spec[i] - base;
      if (excess < 2.8) continue;

      const bw = bandwidthAt(spec, freqs, i, 3);
      const q = f / Math.max(bw, stft.binWidth);
      if (q < 2.2) continue;

      // Persistence: fraction of active frames where this bin is a local peak
      // and above a local floor. Uses frame RMS only (mag not stored) so we
      // re-evaluate from average-spectrum neighborhood as a conservative proxy
      // plus p90-p10 span.
      const p90 = stft.p90SpectrumDb[i];
      const p10 = stft.p10SpectrumDb[i];
      const span = p90 - p10;
      // High persistence → peak present in typical frames (small p90-median gap).
      const persistProxy = U.clamp(1 - (stft.p90SpectrumDb[i] - stft.medianSpectrumDb[i]) / 12, 0, 1);

      const harm = nearHarmonic(f, medianF0);
      let classification = 'Possible Resonance';
      let confidence = 0.45 + U.clamp((excess - 2.8) / 10, 0, 0.3) + U.clamp((q - 2.2) / 20, 0, 0.15) + persistProxy * 0.15;
      if (harm.harmonic) {
        confidence -= 0.22;
        classification = 'Possible Harmonic Energy';
      }
      if (excess >= 6 && q >= 6 && persistProxy >= 0.55 && !harm.harmonic) {
        classification = 'Likely Resonance';
        confidence += 0.08;
      }
      confidence = U.clamp(confidence, 0.15, 0.96);

      if (confidence < 0.55) classification = 'Insufficient evidence for confident resonance classification.';

      candidates.push({
        frequency_hz: U.round(f, 1),
        peak_excess_db: U.round(excess, 2),
        local_baseline_db: U.round(base, 2),
        peak_level_db: U.round(spec[i], 2),
        bandwidth_hz: U.round(bw, 1),
        q: U.round(q, 2),
        persistence: U.round(persistProxy * 100, 1),
        confidence: U.round(confidence * 100, 1),
        classification: classification,
        harmonic_relationship: harm.harmonic ? ('Near H' + harm.n + ' of observed F0 (' + harm.cents.toFixed(0) + ' cents)') : 'Not an integer multiple of observed median F0',
        temporal_span_db: U.round(span, 2),
        evidence: '+' + excess.toFixed(1) + ' dB above local baseline, Q ' + q.toFixed(1) + ', persistence proxy ' + (persistProxy * 100).toFixed(0) + '%'
      });
    }

    candidates.sort(function (a, b) {
      return (b.peak_excess_db * b.confidence) - (a.peak_excess_db * a.confidence);
    });

    // Suppress nearby duplicates (keep strongest within 8%).
    const kept = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const near = kept.some(function (k) { return Math.abs(k.frequency_hz - c.frequency_hz) / c.frequency_hz < 0.08; });
      if (!near) kept.push(c);
      if (kept.length >= 12) break;
    }

    return {
      candidates: kept,
      note: frames.length ? 'Persistence is estimated from spectral percentile stability (median vs 90th percentile), not a decorative score.' : 'Limited frame data; persistence is a low-confidence estimate.',
      insufficient: kept.length === 0
    };
  }

  return { analyzeResonances };
}));
