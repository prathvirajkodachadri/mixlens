'use strict';
/**
 * MixLens Vocal Engine 3.0 — Dynamics measurement.
 * Reports variation with evidence. Does not recommend compression.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VEDynamics = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function analyzeDynamics(mono, sampleRate, loudness) {
    const N = mono.length;
    const frame = Math.max(64, Math.round(sampleRate * 0.05));
    const hop = Math.max(32, Math.round(frame / 2));
    const rmsDb = [];
    const peakDb = [];
    const times = [];

    for (let i = 0; i + frame <= N; i += hop) {
      const r = U.rms(mono, i, i + frame);
      const p = U.peak(mono, i, i + frame);
      rmsDb.push(U.db20(r));
      peakDb.push(U.db20(p));
      times.push((i + frame / 2) / sampleRate);
    }

    const audible = [];
    for (let i = 0; i < rmsDb.length; i++) {
      if (rmsDb[i] > -55) audible.push(rmsDb[i]);
    }
    const src = audible.length ? audible : rmsDb;
    const sorted = U.sortedCopy(src);
    const p10 = U.percentile(sorted, 0.10);
    const p50 = U.percentile(sorted, 0.50);
    const p90 = U.percentile(sorted, 0.90);
    const variation = p90 - p10;

    let classification = 'Narrow';
    if (variation >= 12) classification = 'Very Wide';
    else if (variation >= 8) classification = 'Wide';
    else if (variation >= 5) classification = 'Moderate';
    else if (variation >= 3) classification = 'Controlled';

    const quietSections = [];
    const loudSections = [];
    let qStart = -1, lStart = -1;
    const qThr = p10 + 1.5;
    const lThr = p90 - 1.0;
    for (let i = 0; i < rmsDb.length; i++) {
      const v = rmsDb[i];
      if (v <= qThr && v > -70) {
        if (qStart < 0) qStart = i;
      } else if (qStart >= 0) {
        if (i - qStart >= 4) quietSections.push({ start_s: U.round(times[qStart], 2), end_s: U.round(times[i - 1], 2) });
        qStart = -1;
      }
      if (v >= lThr) {
        if (lStart < 0) lStart = i;
      } else if (lStart >= 0) {
        if (i - lStart >= 3) loudSections.push({ start_s: U.round(times[lStart], 2), end_s: U.round(times[i - 1], 2) });
        lStart = -1;
      }
    }

    const st = (loudness && loudness._shortTerm) ? loudness._shortTerm.map(function (s) { return s.lufs; }).filter(function (v) { return v > -80; }) : [];
    const stVar = st.length > 2 ? (Math.max.apply(null, st) - Math.min.apply(null, st)) : null;

    const globalRms = U.rms(mono);
    const globalPeak = U.peak(mono);
    const crest = U.db20(globalPeak) - U.db20(globalRms);

    return {
      rms_dbfs: U.round(U.db20(globalRms), 2),
      rms_variation_db: U.round(U.stdDev(src), 2),
      peak_variation_db: peakDb.length ? U.round(U.stdDev(peakDb.filter(function (v) { return v > -80; })), 2) : 0,
      crest_factor_db: U.round(crest, 2),
      dynamic_range_estimate_db: U.round(variation, 2),
      short_term_loudness_variation_lu: stVar == null ? null : U.round(stVar, 2),
      quiet_average_dbfs: U.round(p10, 2),
      loud_average_dbfs: U.round(p90, 2),
      median_rms_dbfs: U.round(p50, 2),
      variation_db: U.round(variation, 2),
      classification,
      level_consistency: classification === 'Narrow' || classification === 'Controlled' ? 'Consistent' : 'Variable',
      quiet_sections: quietSections.slice(0, 40),
      loud_sections: loudSections.slice(0, 40),
      evidence: 'Quiet-frame average (10th pct) ' + p10.toFixed(1) + ' dBFS; loud-frame average (90th pct) ' + p90.toFixed(1) + ' dBFS; variation ' + variation.toFixed(1) + ' dB.'
    };
  }

  return { analyzeDynamics };
}));
