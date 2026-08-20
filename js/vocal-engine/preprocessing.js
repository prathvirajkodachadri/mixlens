'use strict';
/**
 * MixLens Vocal Engine 3.0 — Decode-side preprocessing (no mixing / no EQ).
 * Builds a mono analysis channel and lightweight envelope / silence stats.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VEPreprocessing = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

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

  function analyzeSilence(mono, sampleRate) {
    const frame = Math.max(32, Math.round(sampleRate * 0.02));
    const hop = Math.max(16, Math.round(frame / 2));
    let silent = 0, total = 0;
    const thresh = U.dbToLinear(-60);
    for (let i = 0; i + frame <= mono.length; i += hop) {
      const r = U.rms(mono, i, i + frame);
      total++;
      if (r < thresh) silent++;
    }
    return {
      silence_ratio: total ? silent / total : 1,
      frame_ms: 20,
      threshold_dbfs: -60
    };
  }

  function validateAudio(length, sampleRate, duration) {
    const errors = [];
    const warnings = [];
    if (!length) errors.push('Empty file: no samples to analyze.');
    if (sampleRate && sampleRate < 8000) errors.push('Sample rate too low for analysis (' + sampleRate + ' Hz).');
    if (duration != null && duration < 0.08) errors.push('Recording is too short for reliable analysis (minimum ~80 ms).');
    else if (duration != null && duration < 0.35) warnings.push('Very short file. Some modules will report insufficient signal.');
    if (duration != null && duration > 30 * 60) warnings.push('Very long file. Analysis uses decimated frames to stay responsive.');
    return { errors, warnings };
  }

  return { mixToMono, analyzeSilence, validateAudio };
}));
