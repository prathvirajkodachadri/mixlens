'use strict';
/**
 * MixLens Vocal Engine 3.0 — Noise floor from quiet / unvoiced regions only.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VENoise = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function analyzeNoise(mono, sampleRate, pitchTrack) {
    const frame = Math.max(64, Math.round(sampleRate * 0.05));
    const hop = Math.max(32, Math.round(frame / 2));
    const rmsList = [];
    const quietIdx = [];
    const hf = U.applyBiquad(mono, U.designBiquad('highpass', sampleRate, 6000, 0, 0.7));

    for (let i = 0, f = 0; i + frame <= mono.length; i += hop, f++) {
      const r = U.rms(mono, i, i + frame);
      const t = (i + frame / 2) / sampleRate;
      let voiced = false;
      if (pitchTrack && pitchTrack.length) {
        const idx = Math.max(0, Math.min(pitchTrack.length - 1, Math.round(t / Math.max(0.001, (pitchTrack[1] && pitchTrack[0]) ? (pitchTrack[1].time - pitchTrack[0].time) : 0.01))));
        const pt = pitchTrack[Math.min(idx, pitchTrack.length - 1)];
        voiced = !!(pt && pt.voiced);
      }
      rmsList.push({ rms: r, db: U.db20(r), voiced: voiced, i: i });
    }

    const dbs = rmsList.map(function (x) { return x.db; });
    const sorted = U.sortedCopy(dbs);
    const p08 = U.percentile(sorted, 0.08);
    const p15 = U.percentile(sorted, 0.15);
    const p90 = U.percentile(sorted, 0.90);

    const quiet = [];
    for (let i = 0; i < rmsList.length; i++) {
      if (!rmsList[i].voiced && rmsList[i].db <= p15 + 1.5) {
        quiet.push(rmsList[i]);
        quietIdx.push(rmsList[i].i);
      }
    }

    if (quiet.length < 3) {
      return {
        available: false,
        noise_floor_dbfs: null,
        estimated_snr_db: null,
        noise_stability: 'Insufficient Signal',
        classification: 'Insufficient Signal',
        broadband_noise: false,
        high_frequency_hiss: false,
        possible_room_noise: false,
        evidence: 'Noise floor was not estimated because too few quiet/unvoiced frames were available.'
      };
    }

    const qDb = quiet.map(function (q) { return q.db; });
    const floorDb = U.mean(qDb.slice(0, Math.max(2, Math.floor(qDb.length * 0.7))));
    const stability = U.stdDev(qDb);
    const signalDb = p90;
    const snr = signalDb - floorDb;

    let hiss = false;
    if (quietIdx.length) {
      let hfE = 0, flE = 0;
      const take = Math.min(quietIdx.length, 24);
      for (let k = 0; k < take; k++) {
        const s = quietIdx[k];
        hfE += U.rms(hf, s, Math.min(mono.length, s + frame));
        flE += U.rms(mono, s, Math.min(mono.length, s + frame));
      }
      hiss = flE > 0 && (hfE / take) > (flE / take) * 0.35;
    }

    let stabilityLabel = 'Stable';
    if (stability >= 6) stabilityLabel = 'Unstable';
    else if (stability >= 3) stabilityLabel = 'Moderately variable';

    let classification = 'Low';
    if (floorDb > -40) classification = 'High';
    else if (floorDb > -52) classification = 'Moderate';
    else if (floorDb > -64) classification = 'Low–Moderate';

    return {
      available: true,
      noise_floor_dbfs: U.round(floorDb, 2),
      estimated_snr_db: U.round(snr, 2),
      noise_stability: stabilityLabel,
      noise_stability_stdev_db: U.round(stability, 2),
      classification: classification,
      broadband_noise: floorDb > -58,
      high_frequency_hiss: hiss,
      possible_room_noise: floorDb > -55 && stability >= 2.5,
      quiet_frames_used: quiet.length,
      evidence: 'Floor from ' + quiet.length + ' quiet/unvoiced frames (≤15th percentile). Floor ' + floorDb.toFixed(1) + ' dBFS, SNR ' + snr.toFixed(1) + ' dB vs 90th-percentile vocal frames.'
    };
  }

  return { analyzeNoise };
}));
