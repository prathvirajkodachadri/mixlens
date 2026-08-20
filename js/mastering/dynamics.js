'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Dynamics measurement.
 * Crest factor, LRA, peak-to-loudness ratio, and a descriptive dynamic character.
 * Peak − RMS is reported as crest factor, never as official "dynamic range".
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.MADynamics = factory(root.MAUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function classifyCharacter(crest, lra, plr) {
    /* Descriptive only — not a quality judgement. */
    if (crest <= 7.5 && (lra != null && lra <= 4) && plr != null && plr <= 9) return 'Very Dense';
    if (crest <= 9 && (lra == null || lra <= 6) && (plr == null || plr <= 11)) return 'Dense';
    if (crest >= 14 || (lra != null && lra >= 12)) return 'Very Open';
    if (crest >= 12 || (lra != null && lra >= 8)) return 'Open';
    return 'Moderate';
  }

  function analyzeDynamics(mono, sampleRate, loudness, truePeakDb, samplePeakDb) {
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
      if (rmsDb[i] > -60) audible.push(rmsDb[i]);
    }
    const src = audible.length ? audible : rmsDb;
    const sorted = U.sortedCopy(src);
    const p10 = U.percentile(sorted, 0.10);
    const p50 = U.percentile(sorted, 0.50);
    const p90 = U.percentile(sorted, 0.90);
    const variation = p90 - p10;

    const globalRms = U.rms(mono);
    const globalPeak = U.peak(mono);
    const crest = U.db20(globalPeak) - U.db20(globalRms);
    const integrated = loudness && loudness.integrated_lufs;
    const tp = truePeakDb != null ? truePeakDb : samplePeakDb;
    const plr = (integrated != null && integrated > -140 && tp != null) ? (tp - integrated) : null;
    const lra = loudness && loudness.lra_available ? loudness.lra_lu : null;

    const st = (loudness && loudness._shortTerm)
      ? loudness._shortTerm.map(function (s) { return s.lufs; }).filter(function (v) { return v > -80; })
      : [];
    const stVar = st.length > 2 ? (Math.max.apply(null, st) - Math.min.apply(null, st)) : null;

    const character = classifyCharacter(crest, lra, plr);

    const profile = [];
    const maxPts = 800;
    const step = rmsDb.length > maxPts ? Math.ceil(rmsDb.length / maxPts) : 1;
    for (let i = 0; i < rmsDb.length; i += step) {
      profile.push({
        time_s: U.round(times[i], 3),
        rms_dbfs: U.round(rmsDb[i], 2),
        peak_dbfs: U.round(peakDb[i], 2)
      });
    }

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

    return {
      rms_dbfs: U.round(U.db20(globalRms), 2),
      sample_peak_dbfs: U.round(U.db20(globalPeak), 2),
      crest_factor_db: U.round(crest, 2),
      crest_factor_note: 'Crest factor is peak − RMS. It is not an official dynamic-range standard.',
      peak_to_loudness_ratio_db: plr == null ? null : U.round(plr, 2),
      peak_to_loudness_note: 'PLR uses estimated true peak minus integrated LUFS when both are available.',
      lra_lu: lra,
      dynamic_range_estimate_db: U.round(variation, 2),
      dynamic_range_estimate_note: 'Estimated from 10th–90th percentile of 50 ms RMS frames above −60 dBFS. Not a TT DR meter.',
      rms_variation_db: U.round(U.stdDev(src), 2),
      short_term_loudness_variation_lu: stVar == null ? null : U.round(stVar, 2),
      quiet_average_dbfs: U.round(p10, 2),
      loud_average_dbfs: U.round(p90, 2),
      median_rms_dbfs: U.round(p50, 2),
      variation_db: U.round(variation, 2),
      dynamic_character: character,
      quiet_sections: quietSections.slice(0, 40),
      loud_sections: loudSections.slice(0, 40),
      profile: profile,
      evidence: 'Crest factor ' + crest.toFixed(1) + ' dB; LRA ' + (lra == null ? 'n/a' : lra.toFixed(1) + ' LU') +
        '; PLR ' + (plr == null ? 'n/a' : plr.toFixed(1) + ' dB') + '; 50 ms RMS variation ' + variation.toFixed(1) + ' dB. Character: ' + character + '.'
    };
  }

  function correlateLoudnessAndPeaks(loudness, clipping, truePeak, dynamics) {
    const notes = [];
    const integrated = loudness && loudness.integrated_lufs;
    const crest = dynamics && dynamics.crest_factor_db;
    const tp = truePeak && truePeak.value_dbtp;
    if (integrated != null && integrated > -10 && clipping && clipping.detected) {
      notes.push('High integrated loudness coincides with detected clipping events.');
    }
    if (integrated != null && integrated > -11 && crest != null && crest < 8) {
      notes.push('High loudness sections coincide with a reduced crest factor (dense peak-to-RMS relationship).');
    }
    if (truePeak && truePeak.event_count > 8 && integrated != null && integrated > -12) {
      notes.push('High loudness sections coincide with repeated true-peak excursions.');
    }
    if (tp != null && tp > -0.3 && crest != null && crest < 9) {
      notes.push('Sustained high peak density is observed together with limited crest factor.');
    }
    return {
      observations: notes,
      note: notes.length
        ? notes.join(' ')
        : 'No strong coincidence between high loudness and clipping / true-peak / crest-factor compression was measured.'
    };
  }

  return { analyzeDynamics: analyzeDynamics, correlateLoudnessAndPeaks: correlateLoudnessAndPeaks };
}));
