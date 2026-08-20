'use strict';
/**
 * MixLens Vocal Engine 3.0 — Stereo / phase measurement.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VEStereo = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function analyzeStereo(left, right) {
    if (!right || !left || right.length === 0) {
      return {
        applicable: false,
        channels: 1,
        note: 'Mono vocal detected. Stereo-width analysis is not applicable.',
        correlation: 1,
        l_rms_dbfs: U.round(U.db20(U.rms(left)), 2),
        r_rms_dbfs: null,
        l_peak_dbfs: U.round(U.db20(U.peak(left)), 2),
        r_peak_dbfs: null,
        lr_balance_db: 0,
        mid_energy_dbfs: U.round(U.db20(U.rms(left)), 2),
        side_energy_dbfs: null,
        stereo_width_percent: 0,
        mono_compatibility: 'Not applicable (mono)',
        phase_status: 'GOOD'
      };
    }

    const N = Math.min(left.length, right.length);
    let dot = 0, sL = 0, sR = 0, sM = 0, sS = 0, pL = 0, pR = 0;
    for (let i = 0; i < N; i++) {
      const l = left[i], r = right[i];
      const al = Math.abs(l), ar = Math.abs(r);
      if (al > pL) pL = al;
      if (ar > pR) pR = ar;
      dot += l * r;
      sL += l * l;
      sR += r * r;
      const m = (l + r) * 0.70710678;
      const s = (l - r) * 0.70710678;
      sM += m * m;
      sS += s * s;
    }
    const corr = Math.sqrt(sL * sR) > 1e-12 ? U.clamp(dot / Math.sqrt(sL * sR), -1, 1) : 1;
    const width = (sM + sS) > 1e-18 ? (sS / (sM + sS)) * 100 : 0;
    const bal = U.db20(Math.sqrt(sL / N)) - U.db20(Math.sqrt(sR / N));

    let mono = 'Excellent';
    let phase = 'GOOD';
    if (corr < -0.2) { mono = 'Severe cancellation risk'; phase = 'CRITICAL'; }
    else if (corr < 0.3) { mono = 'Poor — thinning likely in mono'; phase = 'HIGH'; }
    else if (corr < 0.7) { mono = 'Moderate'; phase = 'MODERATE'; }
    else if (corr < 0.92) { mono = 'Good'; phase = 'LOW'; }

    return {
      applicable: true,
      channels: 2,
      correlation: U.round(corr, 3),
      l_rms_dbfs: U.round(U.db20(Math.sqrt(sL / N)), 2),
      r_rms_dbfs: U.round(U.db20(Math.sqrt(sR / N)), 2),
      l_peak_dbfs: U.round(U.db20(pL), 2),
      r_peak_dbfs: U.round(U.db20(pR), 2),
      lr_balance_db: U.round(bal, 2),
      mid_energy_dbfs: U.round(U.db20(Math.sqrt(sM / N)), 2),
      side_energy_dbfs: U.round(U.db20(Math.sqrt(sS / N)), 2),
      stereo_width_percent: U.round(width, 2),
      mono_compatibility: mono,
      phase_status: phase,
      note: 'Correlation ' + corr.toFixed(3) + '; side energy ' + width.toFixed(1) + '% of mid+side.'
    };
  }

  return { analyzeStereo };
}));
