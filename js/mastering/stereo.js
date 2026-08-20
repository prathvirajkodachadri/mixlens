'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Stereo image, L/R balance, Mid/Side.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.MAStereo = factory(root.MAUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function widthLabel(sidePct) {
    if (sidePct < 8) return 'Narrow';
    if (sidePct < 22) return 'Moderate';
    if (sidePct < 40) return 'Wide';
    return 'Very Wide';
  }

  function analyzeStereo(left, right, sampleRate) {
    if (!right || !left || right.length === 0) {
      return {
        applicable: false,
        channels: 1,
        master_format: 'Mono',
        note: 'Mono master detected. Stereo-width analysis is not applicable.',
        correlation: 1,
        l_rms_dbfs: U.round(U.db20(U.rms(left)), 2),
        r_rms_dbfs: null,
        l_peak_dbfs: U.round(U.db20(U.peak(left)), 2),
        r_peak_dbfs: null,
        lr_balance_db: 0,
        lr_balance_status: 'GOOD',
        mid_energy_dbfs: U.round(U.db20(U.rms(left)), 2),
        side_energy_dbfs: null,
        mid_side_ratio: null,
        stereo_width_percent: 0,
        stereo_width_label: 'Not applicable',
        width_timeline: []
      };
    }

    const N = Math.min(left.length, right.length);
    let dot = 0, sL = 0, sR = 0, sM = 0, sS = 0, pL = 0, pR = 0;
    let dualAcc = 0;
    for (let i = 0; i < N; i++) {
      const l = left[i], r = right[i];
      const al = Math.abs(l), ar = Math.abs(r);
      if (al > pL) pL = al;
      if (ar > pR) pR = ar;
      dot += l * r;
      sL += l * l;
      sR += r * r;
      const m = (l + r) * 0.5;
      const s = (l - r) * 0.5;
      sM += m * m;
      sS += s * s;
      dualAcc += Math.abs(l - r);
    }
    const corr = Math.sqrt(sL * sR) > 1e-12 ? U.clamp(dot / Math.sqrt(sL * sR), -1, 1) : 1;
    const width = (sM + sS) > 1e-18 ? (sS / (sM + sS)) * 100 : 0;
    const lRms = Math.sqrt(sL / N);
    const rRms = Math.sqrt(sR / N);
    const bal = U.db20(lRms) - U.db20(rRms);
    const meanAbsDiff = dualAcc / N;
    const dualMono = corr > 0.999 && Math.abs(bal) < 0.15 && meanAbsDiff < 1e-4;

    let format = 'Stereo';
    if (dualMono) format = 'Dual mono';
    else if (lRms < 1e-5 && rRms > 1e-4) format = 'Right-only (left silent)';
    else if (rRms < 1e-5 && lRms > 1e-4) format = 'Left-only (right silent)';

    let balStatus = 'GOOD';
    if (Math.abs(bal) >= 3) balStatus = 'WARNING';
    if (Math.abs(bal) >= 6) balStatus = 'FAIL';

    const hop = Math.max(64, Math.round((sampleRate || 48000) * 0.05));
    const widthTimeline = [];
    const maxPts = 800;
    const total = Math.max(1, Math.floor(N / hop));
    const step = total > maxPts ? Math.ceil(total / maxPts) : 1;
    for (let b = 0; b < total; b += step) {
      const a = b * hop;
      const z = Math.min(N, a + hop * step);
      let mE = 0, sE = 0, d = 0, eL = 0, eR = 0;
      const n = z - a;
      for (let i = a; i < z; i++) {
        const l = left[i], r = right[i];
        const m = (l + r) * 0.5;
        const s = (l - r) * 0.5;
        mE += m * m; sE += s * s; d += l * r; eL += l * l; eR += r * r;
      }
      const w = (mE + sE) > 1e-18 ? (sE / (mE + sE)) * 100 : 0;
      const c = Math.sqrt(eL * eR) > 1e-18 ? U.clamp(d / Math.sqrt(eL * eR), -1, 1) : 1;
      widthTimeline.push({
        time_s: U.round(a / (sampleRate || 1), 3),
        width_percent: U.round(w, 2),
        correlation: U.round(c, 3)
      });
    }

    const msRatio = sS > 1e-18 ? sM / sS : null;

    return {
      applicable: true,
      channels: 2,
      master_format: format,
      dual_mono: dualMono,
      correlation: U.round(corr, 3),
      l_rms_dbfs: U.round(U.db20(lRms), 2),
      r_rms_dbfs: U.round(U.db20(rRms), 2),
      l_peak_dbfs: U.round(U.db20(pL), 2),
      r_peak_dbfs: U.round(U.db20(pR), 2),
      lr_balance_db: U.round(bal, 2),
      lr_balance_status: balStatus,
      lr_loudness_note: 'L/R RMS difference ' + U.round(Math.abs(bal), 2) + ' dB. Tiny differences are not flagged.',
      mid_energy_dbfs: U.round(U.db20(Math.sqrt(sM / N)), 2),
      side_energy_dbfs: U.round(U.db20(Math.sqrt(sS / N)), 2),
      mid_side_ratio: msRatio == null ? null : U.round(msRatio, 3),
      stereo_width_percent: U.round(width, 2),
      stereo_width_label: widthLabel(width),
      excessive_stereo: width >= 48,
      width_timeline: widthTimeline,
      note: 'Correlation ' + corr.toFixed(3) + '; side energy ' + width.toFixed(1) + '% of mid+side.'
    };
  }

  return { analyzeStereo: analyzeStereo };
}));
